import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started',
        'installation',
        'quick-start',
      ],
    },
    {
      type: 'category',
      label: 'User Guide',
      collapsed: false,
      items: [
        'user-guide',
        'interface-overview',
        'opening-files',
        'browsing-records',
        'viewing-conversations',
        'tool-calls',
        'search',
        'agent-sessions',
        'analytics',
        'export',
        'settings',
        'keyboard-shortcuts',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      collapsed: false,
      items: [
        'architecture',
        'data-flow',
        'provider-normalization',
        'caching',
        'search-engine',
        'byte-offset-indexing',
      ],
    },
    {
      type: 'category',
      label: 'Frontend',
      collapsed: false,
      items: [
        'frontend',
        'component-hierarchy',
        'state-management',
        'styling',
        'virtual-scrolling',
        'ipc-communication',
      ],
    },
    {
      type: 'category',
      label: 'Backend',
      collapsed: false,
      items: [
        'backend',
        'tauri-commands',
        'jsonl-scanner',
        'normalization-pipeline',
        'agent-event-parsing',
        'cache-layer',
        'search-module',
        'file-watcher',
        'pricing',
        'export-module',
      ],
    },
    {
      type: 'category',
      label: 'Agent Sessions',
      collapsed: false,
      items: [
        'agent-sessions-overview',
        'supported-tools',
        'event-types',
        'subagent-sessions',
        'auto-detection',
      ],
    },
    {
      type: 'category',
      label: 'Development',
      collapsed: false,
      items: [
        'development',
        'project-setup',
        'testing',
        'ci-cd',
        'release-process',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: [
        'ipc-commands',
        'typescript-types',
        'rust-types',
        'css-variables',
        'pricing-table',
      ],
    },
  ],
};

export default sidebars;
