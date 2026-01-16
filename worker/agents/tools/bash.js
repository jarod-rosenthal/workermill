const { spawn } = require('child_process');

module.exports = {
  name: 'bash',
  description: 'Execute a bash command and return the output. Use for running shell commands, git operations, npm commands, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute'
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command (optional)'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 120000 = 2 minutes)'
      }
    },
    required: ['command']
  },

  async execute({ command, cwd, timeout = 120000 }) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let killed = false;

      // Use shell to execute the command
      const child = spawn('bash', ['-c', command], {
        cwd: cwd || process.cwd(),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, timeout);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
        // Truncate if output is too large (1MB limit)
        if (stdout.length > 1024 * 1024) {
          stdout = stdout.slice(0, 1024 * 1024) + '\n... [output truncated]';
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
        // Truncate if output is too large (1MB limit)
        if (stderr.length > 1024 * 1024) {
          stderr = stderr.slice(0, 1024 * 1024) + '\n... [output truncated]';
        }
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (killed) {
          resolve({
            success: false,
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            error: `Command timed out after ${timeout}ms`,
            duration
          });
        } else if (code === 0) {
          resolve({
            success: true,
            exitCode: 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            duration
          });
        } else {
          resolve({
            success: false,
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            error: `Command exited with code ${code}`,
            duration
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        resolve({
          success: false,
          exitCode: -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: `Failed to execute command: ${err.message}`,
          duration
        });
      });
    });
  }
};
