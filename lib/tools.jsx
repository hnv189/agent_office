// tools.jsx — browser-side tool schemas + dispatch to the local Tool Bridge.
// Exports: TOOL_BRIDGE_DEFAULT, getAgentToolSchemas, executeAgentTool.

const TOOL_BRIDGE_DEFAULT = 'http://localhost:4173';

const TOOL_SCHEMAS = {
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
};

function __toolSchema(name) {
  const fn = TOOL_SCHEMAS[name];
  return fn ? { type: 'function', function: fn } : null;
}

function getAgentToolSchemas(agent) {
  const labels = new Set(agent?.tools || []);
  const names = [];
  if (labels.has('files.read')) names.push('list_dir', 'read_file', 'search_files');
  if (labels.has('files.write')) names.push('write_file', 'patch_file');
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

Object.assign(window, { TOOL_BRIDGE_DEFAULT, getAgentToolSchemas, executeAgentTool });
