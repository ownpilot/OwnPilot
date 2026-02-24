/**
 * File Tool Definitions
 *
 * Tool schemas for file system operations.
 */

import type { ToolDefinition } from '../types.js';

export const FILE_TOOL_DEFS: readonly ToolDefinition[] = [
  {
    name: 'create_folder',
    description: 'Create a folder (directory) in the workspace. Can create nested folders.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path of the folder to create (e.g., "projects/my-project" or "notes/2024")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write content to a file in the workspace. Creates the file if it does not exist, or overwrites if it does. Parent folders are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path of the file (e.g., "notes/meeting.md" or "data/contacts.json")',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file from the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file to read',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and folders in a directory within the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the directory to list (use "" or "/" for workspace root)',
        },
        recursive: {
          type: 'boolean',
          description: 'If true, list files recursively in subdirectories (default: false)',
        },
      },
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or empty folder from the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file or folder to delete',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file or folder within the workspace',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Current relative path of the file or folder',
        },
        destination: {
          type: 'string',
          description: 'New relative path for the file or folder',
        },
      },
      required: ['source', 'destination'],
    },
  },
];
