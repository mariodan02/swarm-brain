// Where the page links to. tools/export_llm_page.py writes a different version of this file
// when the page is published on the wiki, so that "back" leads to the wiki, not to Swarm Brain.
export const LINKS = {
  back: {
    it: { href: '../?lang=it', text: '← swarm brain' },
    en: { href: '../?lang=en', text: '← swarm brain' },
  },
  wiki: {
    it: 'https://wiki.daniellomario.com/it/llm-inference',
    en: 'https://wiki.daniellomario.com/llm-inference',
  },
};
