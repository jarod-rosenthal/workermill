/**
 * WorkerMill Universal Agent Tools
 *
 * A collection of tools for AI agents to interact with the filesystem and execute commands.
 * Uses only Node.js built-in modules (no npm dependencies).
 */

const bash = require('./bash');
const read_file = require('./read_file');
const write_file = require('./write_file');
const edit_file = require('./edit_file');
const glob = require('./glob');
const grep = require('./grep');

const tools = {
  bash,
  read_file,
  write_file,
  edit_file,
  glob,
  grep,

  /**
   * Get all tools as a list
   */
  getAll() {
    return [bash, read_file, write_file, edit_file, glob, grep];
  },

  /**
   * Get OpenAI-format tool definitions for API calls
   */
  getToolDefinitions() {
    return this.getAll().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  },

  /**
   * Get Anthropic Claude format tool definitions
   */
  getClaudeToolDefinitions() {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  },

  /**
   * Execute a tool by name with given arguments
   */
  async execute(toolName, args) {
    const tool = tools[toolName];
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${toolName}. Available tools: ${this.getAll().map(t => t.name).join(', ')}`
      };
    }

    try {
      return await tool.execute(args);
    } catch (err) {
      return {
        success: false,
        error: `Tool execution failed: ${err.message}`,
        stack: err.stack
      };
    }
  },

  /**
   * Process a tool call from an LLM response
   * Handles both OpenAI and Anthropic formats
   */
  async processToolCall(toolCall) {
    let toolName, args;

    // OpenAI format: { function: { name, arguments } }
    if (toolCall.function) {
      toolName = toolCall.function.name;
      args = typeof toolCall.function.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    }
    // Anthropic format: { name, input }
    else if (toolCall.name) {
      toolName = toolCall.name;
      args = toolCall.input || {};
    }
    else {
      return {
        success: false,
        error: 'Invalid tool call format'
      };
    }

    return await this.execute(toolName, args);
  }
};

module.exports = tools;
