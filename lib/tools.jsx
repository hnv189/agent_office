// tools.jsx — browser-side tool schemas + dispatch to the local Tool Bridge.
// Catalog mirrors the core general-purpose tools of Nous Research's Hermes
// Agent (file, terminal, code, web, memory, skills, todo, clarify, vision),
// grouped under coarse capability labels the user toggles per agent.
// Exports: TOOL_BRIDGE_DEFAULT, TOOL_SCHEMAS, CAP_TOOLS, getAgentToolSchemas, executeAgentTool.

const TOOL_BRIDGE_DEFAULT = 'http://localhost:4173';

const TOOL_SCHEMAS = {
  // ── File (capability: files.read / files.write) ───────────────────────────
  list_dir: {
    name: 'list_dir',
    description: 'List files and folders inside the configured local workspace. Use before reading unknown paths.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to the workspace root. Defaults to ".".', default: '.' },
        limit: { type: 'integer', description: 'Maximum number of entries to return.', default: 120, minimum: 1, maximum: 500 },
      },
    },
  },
  read_file: {
    name: 'read_file',
    description: 'Read a text file from the local workspace with line pagination.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        offset: { type: 'integer', description: '1-based starting line.', default: 1, minimum: 1 },
        limit: { type: 'integer', description: 'Maximum number of lines to read.', default: 300, minimum: 1, maximum: 1200 },
      },
      required: ['path'],
    },
  },
  search_files: {
    name: 'search_files',
    description: 'Search for files by name or text content inside the local workspace.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Text/regex pattern to search for, or a filename/glob when target="files".' },
        target: { type: 'string', enum: ['content', 'files'], description: 'Search file contents or file names.', default: 'content' },
        path: { type: 'string', description: 'Directory path relative to the workspace root.', default: '.' },
        file_glob: { type: 'string', description: 'Optional file glob such as "*.jsx" or "*.md".' },
        limit: { type: 'integer', description: 'Maximum results.', default: 50, minimum: 1, maximum: 200 },
      },
      required: ['pattern'],
    },
  },
  write_file: {
    name: 'write_file',
    description: 'Create or completely replace a text file in the local workspace. Prefer patch_file for small edits.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        content: { type: 'string', description: 'Complete file content to write.' },
      },
      required: ['path', 'content'],
    },
  },
  patch_file: {
    name: 'patch_file',
    description: 'Replace exact text in a local workspace file. Use this for targeted edits.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        old_string: { type: 'string', description: 'Exact text to replace. Must exist in the file.' },
        new_string: { type: 'string', description: 'Replacement text. Use an empty string to delete.' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences instead of requiring exactly one.', default: false },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },

  // ── Terminal (capability: shell) ──────────────────────────────────────────
  run_terminal: {
    name: 'run_terminal',
    description: 'Run a shell command in the local workspace and return its stdout, stderr and exit code. Commands time out after ~30s.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        cwd: { type: 'string', description: 'Working directory relative to the workspace root.', default: '.' },
        timeout_ms: { type: 'integer', description: 'Timeout in milliseconds.', default: 30000, minimum: 1000, maximum: 120000 },
      },
      required: ['command'],
    },
  },

  // ── Code execution (capability: code.run) ─────────────────────────────────
  execute_code: {
    name: 'execute_code',
    description: 'Execute a snippet of Python, JavaScript or Bash and return its output. Use for calculations, data transforms, and quick checks.',
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['python', 'javascript', 'bash'], description: 'Language of the snippet.', default: 'python' },
        code: { type: 'string', description: 'Source code to run.' },
        timeout_ms: { type: 'integer', description: 'Timeout in milliseconds.', default: 30000, minimum: 1000, maximum: 120000 },
      },
      required: ['code'],
    },
  },

  // ── Web (capability: web.search) ──────────────────────────────────────────
  web_search: {
    name: 'web_search',
    description: 'Search the web and return a list of result titles, URLs and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        limit: { type: 'integer', description: 'Maximum number of results.', default: 6, minimum: 1, maximum: 15 },
      },
      required: ['query'],
    },
  },
  web_fetch: {
    name: 'web_fetch',
    description: 'Fetch a URL and return its readable text content (HTML stripped). Use after web_search to read a page.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The absolute http(s) URL to fetch.' },
        max_chars: { type: 'integer', description: 'Maximum characters of text to return.', default: 6000, minimum: 200, maximum: 40000 },
      },
      required: ['url'],
    },
  },

  // ── Memory (capability: memory) ───────────────────────────────────────────
  memory_write: {
    name: 'memory_write',
    description: 'Persist a durable memory (a fact, preference or learning) so it can be recalled in future runs.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The memory content to store.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for later retrieval.' },
      },
      required: ['text'],
    },
  },
  memory_search: {
    name: 'memory_search',
    description: 'Search previously stored memories by keyword or tag. Returns matching entries newest-first.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword or tag to match. Empty returns the most recent memories.', default: '' },
        limit: { type: 'integer', description: 'Maximum entries to return.', default: 10, minimum: 1, maximum: 50 },
      },
    },
  },

  // ── Skills (capability: skills) — Hermes SKILL.md files ───────────────────
  skill_create: {
    name: 'skill_create',
    description: 'Create or overwrite a reusable skill as a SKILL.md file (procedural instructions for a recurring task).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name (kebab-case). Becomes the file name.' },
        description: { type: 'string', description: 'One-line summary of when to use this skill.' },
        body: { type: 'string', description: 'Markdown body: the step-by-step procedure.' },
      },
      required: ['name', 'body'],
    },
  },
  skill_list: {
    name: 'skill_list',
    description: 'List available skills with their names and descriptions.',
    parameters: { type: 'object', properties: {} },
  },
  skill_read: {
    name: 'skill_read',
    description: 'Read the full content of a named skill before following it.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill name to read.' } },
      required: ['name'],
    },
  },

  // ── Todo (capability: todo) ───────────────────────────────────────────────
  todo_write: {
    name: 'todo_write',
    description: 'Replace the working todo list for the current task. Use to plan and track multi-step work.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The full ordered list of todo items.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'What needs to be done.' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'done'], default: 'pending' },
            },
            required: ['content'],
          },
        },
      },
      required: ['items'],
    },
  },
  todo_read: {
    name: 'todo_read',
    description: 'Read the current todo list and each item\'s status.',
    parameters: { type: 'object', properties: {} },
  },

  // ── Clarify (capability: clarify) ─────────────────────────────────────────
  clarify: {
    name: 'clarify',
    description: 'Ask the user a clarifying question when the task is ambiguous. Returns the question for the user to answer.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The specific question to ask the user.' },
      },
      required: ['question'],
    },
  },

  // ── Vision / media (capability: vision) ───────────────────────────────────
  vision_analyze: {
    name: 'vision_analyze',
    description: 'Analyse an image (by URL or workspace path) and answer a question about it. Requires a vision backend configured on the Tool Bridge.',
    parameters: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Image URL or workspace-relative path.' },
        prompt: { type: 'string', description: 'What to look for or describe.', default: 'Describe this image.' },
      },
      required: ['image'],
    },
  },
  image_generate: {
    name: 'image_generate',
    description: 'Generate an image from a text prompt and save it to the workspace. Requires an image backend configured on the Tool Bridge.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text description of the image to generate.' },
        path: { type: 'string', description: 'Workspace-relative output path (e.g. "out/image.png").', default: 'generated.png' },
      },
      required: ['prompt'],
    },
  },
};

// capability label (editor chip) → tool names it unlocks
const CAP_TOOLS = {
  'files.read':  ['list_dir', 'read_file', 'search_files'],
  'files.write': ['write_file', 'patch_file'],
  'shell':       ['run_terminal'],
  'code.run':    ['execute_code'],
  'web.search':  ['web_search', 'web_fetch'],
  'memory':      ['memory_write', 'memory_search'],
  'skills':      ['skill_create', 'skill_list', 'skill_read'],
  'todo':        ['todo_write', 'todo_read'],
  'clarify':     ['clarify'],
  'vision':      ['vision_analyze', 'image_generate'],
};

function __toolSchema(name) {
  const fn = TOOL_SCHEMAS[name];
  return fn ? { type: 'function', function: fn } : null;
}

function getAgentToolSchemas(agent) {
  const labels = new Set(agent?.tools || []);
  const names = [];
  for (const label of labels) {
    for (const t of (CAP_TOOLS[label] || [])) {
      if (!names.includes(t)) names.push(t);
    }
  }
  return names.map(__toolSchema).filter(Boolean);
}

function __toolBridgeBase(settings) {
  return (settings?.tools?.baseUrl || TOOL_BRIDGE_DEFAULT).replace(/\/$/, '');
}

async function executeAgentTool(name, args = {}, { settings } = {}) {
  const base = __toolBridgeBase(settings);
  const r = await fetch(base + '/api/tools/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, args }),
  });
  const text = await r.text();
  if (!r.ok) return JSON.stringify({ error: `Tool Bridge ${r.status}: ${text}` });
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

Object.assign(window, { TOOL_BRIDGE_DEFAULT, TOOL_SCHEMAS, CAP_TOOLS, getAgentToolSchemas, executeAgentTool });
