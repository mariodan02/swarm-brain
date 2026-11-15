"""Train the tiny letter-level GPT shown in frontend/llm/ and export it as JSON.

Training data: the distinct words of Dante's Divina Commedia (public domain), from the
Project Gutenberg plain-text edition (ebook 1012). The model learns to continue a word one
letter at a time, so it ends up inventing words that sound like Dante's Italian.

Needs torch (not part of the backend requirements). From the project root:
    python3 -m venv .venv-train && .venv-train/bin/pip install torch
    curl -L -o /tmp/pg1012.txt https://www.gutenberg.org/cache/epub/1012/pg1012.txt
    .venv-train/bin/python tools/train_tiny_gpt.py /tmp/pg1012.txt
"""
from __future__ import annotations

import json
import math
import re
import sys
import unicodedata
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

OUT = Path(__file__).resolve().parent.parent / "frontend" / "llm" / "model.json"

VOCAB = "." + "abcdefghijklmnopqrstuvwxyz"   # token 0 ('.') marks both the start and the end of a word
BLOCK = 12                                   # context length: '.' plus up to 11 letters
N_EMBD, N_HEAD, N_LAYER = 24, 3, 2
STEPS, BATCH, LR, SEED = 6000, 256, 3e-3, 1321
DECIMALS = 5                                 # weights are rounded before export; the browser gets the same numbers


def load_words(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    start = text.index("*** START OF THE PROJECT GUTENBERG EBOOK")
    end = text.index("*** END OF THE PROJECT GUTENBERG EBOOK")
    text = text[text.index("\n", start) : end]
    text = re.sub(r"\bCanto\s+[IVXLC]+\b", " ", text)  # canto numbers are not words
    # Accented letters become plain ones (è -> e): the vocabulary is a-z only.
    text = "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))
    words = {w for w in re.split(r"[^a-z]+", text) if 3 <= len(w) <= BLOCK - 1}
    return sorted(words)


class Block(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.ln1 = nn.LayerNorm(N_EMBD)
        self.qkv = nn.Linear(N_EMBD, 3 * N_EMBD)
        self.proj = nn.Linear(N_EMBD, N_EMBD)
        self.ln2 = nn.LayerNorm(N_EMBD)
        self.fc = nn.Linear(N_EMBD, 4 * N_EMBD)
        self.out = nn.Linear(4 * N_EMBD, N_EMBD)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, C = x.shape
        q, k, v = self.qkv(self.ln1(x)).split(C, dim=2)
        q, k, v = (t.view(B, T, N_HEAD, C // N_HEAD).transpose(1, 2) for t in (q, k, v))
        att = (q @ k.transpose(-2, -1)) / math.sqrt(C // N_HEAD)
        att = att.masked_fill(torch.triu(torch.ones(T, T, dtype=torch.bool), 1), float("-inf"))
        y = (F.softmax(att, dim=-1) @ v).transpose(1, 2).contiguous().view(B, T, C)
        x = x + self.proj(y)
        return x + self.out(F.gelu(self.fc(self.ln2(x)), approximate="tanh"))


class TinyGPT(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.wte = nn.Embedding(len(VOCAB), N_EMBD)
        self.wpe = nn.Embedding(BLOCK, N_EMBD)
        self.h = nn.ModuleList(Block() for _ in range(N_LAYER))
        self.ln_f = nn.LayerNorm(N_EMBD)
        self.head = nn.Linear(N_EMBD, len(VOCAB), bias=False)

    def forward(self, idx: torch.Tensor) -> torch.Tensor:
        x = self.wte(idx) + self.wpe(torch.arange(idx.shape[1]))
        for block in self.h:
            x = block(x)
        return self.head(self.ln_f(x))


def encode(words: list[str]) -> tuple[torch.Tensor, torch.Tensor]:
    """Input '.word' and target 'word.', padded; padded targets are -1 and ignored by the loss."""
    x = torch.zeros(len(words), BLOCK, dtype=torch.long)
    y = torch.full((len(words), BLOCK), -1, dtype=torch.long)
    for i, word in enumerate(words):
        ids = [VOCAB.index(c) for c in word]
        x[i, 1 : len(ids) + 1] = torch.tensor(ids)
        y[i, : len(ids)] = torch.tensor(ids)
        y[i, len(ids)] = 0
    return x, y


def loss_of(model: TinyGPT, x: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
    return F.cross_entropy(model(x).view(-1, len(VOCAB)), y.view(-1), ignore_index=-1)


@torch.no_grad()
def sample(model: TinyGPT, gen: torch.Generator) -> str:
    idx = [0]
    while len(idx) < BLOCK:
        probs = F.softmax(model(torch.tensor([idx]))[0, -1], dim=-1)
        nxt = int(torch.multinomial(probs, 1, generator=gen))
        if nxt == 0:
            break
        idx.append(nxt)
    return "".join(VOCAB[i] for i in idx[1:])


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    torch.manual_seed(SEED)
    words = load_words(Path(sys.argv[1]))
    perm = torch.randperm(len(words)).tolist()
    n_val = len(words) // 10
    val_x, val_y = encode([words[i] for i in perm[:n_val]])
    train_x, train_y = encode([words[i] for i in perm[n_val:]])
    print(f"{len(words)} distinct words, {len(words) - n_val} train / {n_val} validation")

    model = TinyGPT()
    n_params = sum(p.numel() for p in model.parameters())
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, STEPS)
    for step in range(1, STEPS + 1):
        batch = torch.randint(0, len(train_x), (BATCH,))
        loss = loss_of(model, train_x[batch], train_y[batch])
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        sched.step()
        if step % 1000 == 0:
            with torch.no_grad():
                print(f"step {step}: train {loss.item():.3f}  validation {loss_of(model, val_x, val_y).item():.3f}")

    # Round the weights, then measure and export the rounded model: what is reported is what ships.
    model.eval()
    with torch.no_grad():
        for p in model.parameters():
            p.copy_(torch.round(p * 10**DECIMALS) / 10**DECIMALS)
        train_loss = loss_of(model, train_x, train_y).item()
        val_loss = loss_of(model, val_x, val_y).item()
        test_tokens = [VOCAB.index(c) for c in ".selv"]
        test_logits = model(torch.tensor([test_tokens]))[0, -1].tolist()
    gen = torch.Generator().manual_seed(SEED)
    samples = [sample(model, gen) for _ in range(40)]
    known = set(words)
    print(f"rounded model: train {train_loss:.3f}  validation {val_loss:.3f}  ({n_params} parameters)")
    print("samples:", " ".join(f"{w}{'*' if w in known else ''}" for w in samples), "\n(* = a real word of the text)")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "config": {"vocab": VOCAB, "block": BLOCK, "n_embd": N_EMBD, "n_head": N_HEAD, "n_layer": N_LAYER},
                "info": {
                    "params": n_params, "words": len(words), "steps": STEPS,
                    "train_loss": round(train_loss, 3), "val_loss": round(val_loss, 3),
                    "source": "Dante Alighieri, La Divina Commedia (Project Gutenberg, ebook 1012)",
                },
                "test": {"tokens": test_tokens, "logits": [round(v, 5) for v in test_logits]},
                "tensors": {
                    name: {"shape": list(t.shape), "data": [round(v, DECIMALS) for v in t.flatten().tolist()]}
                    for name, t in model.state_dict().items()
                },
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
