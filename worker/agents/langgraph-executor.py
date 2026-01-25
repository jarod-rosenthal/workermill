***REMOVED***!/usr/bin/env python3
"""
LangGraph ReAct Executor for WorkerMill

A unified autonomous coding agent using LangGraph's ReAct pattern.
Supports multiple AI providers: Ollama, OpenAI, Google Gemini, Groq, Mistral, Azure, and more.

Features:
- LangGraph create_react_agent for Thought -> Action -> Observation loop
- State management for test result caching and file tracking
- Multi-provider support via LangChain integrations
- Full tool suite: bash, read_file, write_file, edit_file, glob, grep

Usage:
    ***REMOVED*** Ollama (default)
    python langgraph-executor.py --model llama3.1:8b --prompt "Fix the bug"

    ***REMOVED*** OpenAI
    python langgraph-executor.py --provider openai --model gpt-4o --prompt "Fix the bug"

    ***REMOVED*** Google Gemini
    python langgraph-executor.py --provider gemini --model gemini-1.5-pro --prompt "Fix the bug"

    ***REMOVED*** Groq
    python langgraph-executor.py --provider groq --model llama-3.1-70b-versatile --prompt "Fix the bug"

Environment Variables:
    WORKER_PROVIDER       - AI provider: ollama, openai, gemini, groq, mistral, azure (default: ollama)
    OLLAMA_HOST           - Ollama server URL (default: http://localhost:11434)
    OPENAI_API_KEY        - OpenAI API key (required for openai provider)
    GOOGLE_API_KEY        - Google API key (required for gemini provider)
    GROQ_API_KEY          - Groq API key (required for groq provider)
    MISTRAL_API_KEY       - Mistral API key (required for mistral provider)
    AZURE_API_KEY         - Azure OpenAI API key (required for azure provider)
    AZURE_API_BASE        - Azure OpenAI endpoint URL (required for azure provider)
    AZURE_API_VERSION     - Azure OpenAI API version (default: 2024-02-15-preview)
    AGENT_WORKING_DIR     - Working directory (default: cwd)
    AGENT_MAX_ITERATIONS  - Max iterations (default: 100)
    AGENT_VERBOSE         - Enable verbose logging (true/false)
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import create_react_agent

***REMOVED*** Core providers (always available)
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

***REMOVED*** Optional providers - lazy loaded to avoid import errors if not installed
def _get_chat_google():
    """Lazy load Google Gemini chat model."""
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI
    except ImportError:
        raise ImportError(
            "langchain-google-genai is required for Gemini provider. "
            "Install with: pip install langchain-google-genai"
        )

def _get_chat_groq():
    """Lazy load Groq chat model."""
    try:
        from langchain_groq import ChatGroq
        return ChatGroq
    except ImportError:
        raise ImportError(
            "langchain-groq is required for Groq provider. "
            "Install with: pip install langchain-groq"
        )

def _get_chat_mistral():
    """Lazy load Mistral chat model."""
    try:
        from langchain_mistralai import ChatMistralAI
        return ChatMistralAI
    except ImportError:
        raise ImportError(
            "langchain-mistralai is required for Mistral provider. "
            "Install with: pip install langchain-mistralai"
        )

def _get_azure_chat_openai():
    """Lazy load Azure OpenAI chat model."""
    try:
        from langchain_openai import AzureChatOpenAI
        return AzureChatOpenAI
    except ImportError:
        raise ImportError(
            "langchain-openai is required for Azure provider. "
            "Install with: pip install langchain-openai"
        )

***REMOVED*** =============================================================================
***REMOVED*** Configuration
***REMOVED*** =============================================================================

***REMOVED*** Provider selection (ollama, openai, gemini, groq, mistral, azure)
WORKER_PROVIDER = os.environ.get("WORKER_PROVIDER", "ollama").lower()

***REMOVED*** Provider-specific configuration
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY", "")
XAI_API_KEY = os.environ.get("XAI_API_KEY", "")  ***REMOVED*** Grok (xAI)
AZURE_API_KEY = os.environ.get("AZURE_API_KEY", "")
AZURE_API_BASE = os.environ.get("AZURE_API_BASE", "")
AZURE_API_VERSION = os.environ.get("AZURE_API_VERSION", "2024-02-15-preview")

***REMOVED*** Legacy vLLM support (OpenAI-compatible endpoint)
VLLM_BASE_URL = os.environ.get("VLLM_BASE_URL", "")

***REMOVED*** General configuration
WORKING_DIR = Path(os.environ.get("AGENT_WORKING_DIR", os.getcwd()))
MAX_ITERATIONS = int(os.environ.get("AGENT_MAX_ITERATIONS", "100"))
VERBOSE = os.environ.get("AGENT_VERBOSE", "false").lower() == "true"

***REMOVED*** Supported providers and their default models (updated 2024-01)
PROVIDER_DEFAULTS = {
    "ollama": "qwen2.5-coder:32b",
    "openai": "gpt-5.1-codex",
    "gemini": "gemini-3-pro-preview",
    "google": "gemini-3-pro-preview",  ***REMOVED*** Alias for gemini
    "groq": "llama-3.1-70b-versatile",
    "mistral": "mistral-large-latest",
    "xai": "grok-2",  ***REMOVED*** Elon Musk's Grok
    "grok": "grok-2",  ***REMOVED*** Alias for xai
    "azure": "gpt-4o",
}

***REMOVED*** Output markers (WorkerMill convention)
MARKERS = {
    "RESULT": "::result::",
    "PR_URL": "::pr_url::",
    "ERROR": "::error::",
    "COST": "::cost::",
    "INPUT_TOKENS": "::input_tokens::",
    "OUTPUT_TOKENS": "::output_tokens::",
}


***REMOVED*** =============================================================================
***REMOVED*** Agent State
***REMOVED*** =============================================================================


class TestResult(TypedDict):
    """Cached test result."""

    success: bool
    output: str
    timestamp: float


class AgentState(TypedDict):
    """State schema for the LangGraph ReAct agent.

    Key advantages of LangGraph state:
    - Persists across iterations
    - Enables test result caching
    - Tracks modified files to invalidate cache
    - Provides iteration counting
    """

    messages: Annotated[list[BaseMessage], add_messages]
    test_results: dict[str, TestResult]  ***REMOVED*** command -> {success, output, timestamp}
    modified_files: set[str]  ***REMOVED*** Files that have been written/edited
    iteration: int  ***REMOVED*** Current iteration count
    files_modified_since_test: bool  ***REMOVED*** Track if cache is stale
    input_tokens: int  ***REMOVED*** Total input tokens used
    output_tokens: int  ***REMOVED*** Total output tokens used


def create_initial_state() -> AgentState:
    """Create the initial agent state."""
    return AgentState(
        messages=[],
        test_results={},
        modified_files=set(),
        iteration=0,
        files_modified_since_test=False,
        input_tokens=0,
        output_tokens=0,
    )


***REMOVED*** =============================================================================
***REMOVED*** State Manager (Singleton for tool access)
***REMOVED*** =============================================================================


@dataclass
class StateManager:
    """Manages shared state accessible from tools.

    Tools need access to state for:
    - Tracking modified files (invalidates test cache)
    - Checking cached test results
    - Recording new test results
    - Tracking failed edit attempts per file
    - Caching file contents for better edit guidance
    """

    test_results: dict[str, TestResult] = field(default_factory=dict)
    modified_files: set[str] = field(default_factory=set)
    files_modified_since_test: bool = False
    edit_failures: dict[str, int] = field(default_factory=dict)  ***REMOVED*** filepath -> failure count
    recent_bash_commands: list[str] = field(default_factory=list)  ***REMOVED*** Track recent bash commands for loop detection
    file_contents_cache: dict[str, str] = field(default_factory=dict)  ***REMOVED*** Cache file contents for edit guidance
    last_failed_edit: dict[str, dict] = field(default_factory=dict)  ***REMOVED*** Track last failed edit params per file

    def mark_file_modified(self, filepath: str) -> None:
        """Mark a file as modified, invalidating test cache."""
        self.modified_files.add(filepath)
        if not self.files_modified_since_test:
            log("[cache] Files modified, test cache invalidated")
        self.files_modified_since_test = True

    def get_cached_test(self, command: str) -> TestResult | None:
        """Get cached test result if valid."""
        if self.files_modified_since_test:
            return None

        cached = self.test_results.get(command)
        if cached:
            age = time.time() - cached["timestamp"]
            log(f"[cache] Found cached test result ({age:.1f}s old) for: {command[:50]}")
            return cached
        return None

    def cache_test_result(self, command: str, result: TestResult) -> None:
        """Cache a test result."""
        self.test_results[command] = result
        self.files_modified_since_test = False
        log(f"[cache] Cached test result for: {command[:50]}")

    def record_edit_failure(self, filepath: str, old_string: str = "", new_string: str = "") -> int:
        """Record a failed edit attempt for a file. Returns the failure count."""
        self.edit_failures[filepath] = self.edit_failures.get(filepath, 0) + 1
        ***REMOVED*** Store the failed edit params for guidance
        self.last_failed_edit[filepath] = {"old_string": old_string, "new_string": new_string}
        log(f"[edit] Failed edit attempt ***REMOVED***{self.edit_failures[filepath]} for: {filepath}")
        return self.edit_failures[filepath]

    def clear_edit_failures(self, filepath: str) -> None:
        """Clear edit failure count for a file (after successful edit)."""
        if filepath in self.edit_failures:
            del self.edit_failures[filepath]
        if filepath in self.last_failed_edit:
            del self.last_failed_edit[filepath]

    def cache_file_content(self, filepath: str, content: str) -> None:
        """Cache file content for edit guidance."""
        self.file_contents_cache[filepath] = content

    def get_edit_guidance(self, filepath: str, failure_count: int) -> str:
        """Get guidance message based on number of failed edit attempts.

        Provides progressively more specific guidance:
        - Failure 1: Read the file first
        - Failure 2: Use write_file with explicit instructions
        - Failure 3+: FORCE write_file with ready-to-use content
        """
        cached_content = self.file_contents_cache.get(filepath, "")
        last_edit = self.last_failed_edit.get(filepath, {})
        new_string = last_edit.get("new_string", "")

        if failure_count == 1:
            return (
                f"EDIT FAILED: The old_string didn't match the file content.\n\n"
                f"REQUIRED ACTION: Read the file first:\n"
                f"  read_file(path=\"{filepath}\")\n\n"
                f"Then copy the EXACT text you want to replace (including whitespace/indentation) "
                f"and use it as old_string in edit_file."
            )
        elif failure_count == 2:
            ***REMOVED*** Provide more specific guidance with the cached content
            content_preview = ""
            if cached_content:
                ***REMOVED*** Show first 500 chars of the file to help model find the right location
                lines = cached_content.split("\n")[:20]
                content_preview = f"\n\nFILE CONTENT (first 20 lines):\n```\n" + "\n".join(lines) + "\n```\n"

            return (
                f"EDIT FAILED AGAIN on {filepath}.{content_preview}\n"
                f"The file content may have changed since you last read it.\n\n"
                f"TWO OPTIONS:\n"
                f"1. Read the file again with read_file(), find the exact text, try one more edit_file\n"
                f"2. Use write_file() to rewrite the entire file with your changes included\n\n"
                f"If you use write_file, read the current file content first, modify it, then write the complete modified content."
            )
        else:
            ***REMOVED*** Failure 3+: Strongly push toward write_file
            return (
                f"EDIT HAS FAILED {failure_count} TIMES on {filepath}.\n\n"
                f"DO NOT ATTEMPT ANOTHER edit_file on this file.\n\n"
                f"YOU MUST DO ONE OF:\n"
                f"1. Use write_file() to write the complete file with your changes:\n"
                f"   - First: read_file(path=\"{filepath}\") to get current content\n"
                f"   - Then: Modify the content in your response\n"
                f"   - Finally: write_file(path=\"{filepath}\", content=\"<modified content>\")\n\n"
                f"2. OR skip this file and continue with other tasks.\n\n"
                f"Continuing to retry edit_file will waste iterations. Move forward NOW."
            )

    def check_bash_loop(self, command: str) -> tuple[bool, str, bool]:
        """Check if we're in a bash command loop. Returns (is_loop, guidance, force_stop)."""
        ***REMOVED*** Normalize command for comparison (strip whitespace variations)
        normalized = " ".join(command.split())

        ***REMOVED*** Keep only last 15 commands
        self.recent_bash_commands.append(normalized)
        if len(self.recent_bash_commands) > 15:
            self.recent_bash_commands.pop(0)

        ***REMOVED*** Check if similar command was run recently
        similar_count = sum(1 for cmd in self.recent_bash_commands[-8:] if self._commands_similar(cmd, normalized))

        if similar_count >= 5:
            ***REMOVED*** CRITICAL: 5+ identical commands - this is a hard loop, force stop
            log(f"[loop] CRITICAL bash command loop ({similar_count} similar commands) - forcing stop")
            return True, (
                "⚠️ CRITICAL LOOP DETECTED - YOU HAVE RUN THE SAME COMMAND 5+ TIMES ⚠️\n\n"
                "The Jira comment was successfully posted. You can see 'success':true in every response.\n"
                "STOP POSTING COMMENTS IMMEDIATELY.\n\n"
                "Your task is to MODIFY CODE FILES, not keep posting Jira comments.\n"
                "Use glob() to find the file, then read_file() to see it, then write_file() or edit_file() to change it.\n\n"
                "DO NOT call bash with add_comment.js again. Move to the actual coding work NOW."
            ), True  ***REMOVED*** Force stop flag
        elif similar_count >= 3:
            log(f"[loop] Detected bash command loop ({similar_count} similar commands)")
            return True, (
                "You are repeating the same bash command. The command succeeded (success:true). "
                "STOP retrying and move on to the actual coding task. Use glob/read_file/write_file to modify code."
            ), False

        return False, "", False

    def _commands_similar(self, cmd1: str, cmd2: str) -> bool:
        """Check if two commands are similar (same tool being called)."""
        ***REMOVED*** Check if they're calling the same script
        if "add_comment.js" in cmd1 and "add_comment.js" in cmd2:
            return True
        if "transition_issue.js" in cmd1 and "transition_issue.js" in cmd2:
            return True
        ***REMOVED*** Exact match
        return cmd1 == cmd2


***REMOVED*** Global state manager (tools need access)
state_manager = StateManager()


***REMOVED*** =============================================================================
***REMOVED*** Utility Functions
***REMOVED*** =============================================================================


def log(message: str) -> None:
    """Log message if verbose mode is enabled."""
    if VERBOSE:
        print(f"[DEBUG] {message}", file=sys.stderr)


def resolve_path(filepath: str) -> Path:
    """Resolve a path relative to the working directory."""
    path = Path(filepath)
    if path.is_absolute():
        return path
    return WORKING_DIR / path


def is_test_command(command: str) -> bool:
    """Check if a command is a test command."""
    test_patterns = [
        r"\bnpm\s+(run\s+)?test\b",
        r"\bnpx\s+(jest|vitest|mocha)\b",
        r"\byarn\s+(run\s+)?test\b",
        r"\bpnpm\s+(run\s+)?test\b",
        r"\bpython\s+-m\s+pytest\b",
        r"\bpytest\b",
        r"\bcargo\s+test\b",
        r"\bgo\s+test\b",
        r"\bmake\s+test\b",
    ]
    return any(re.search(pattern, command) for pattern in test_patterns)


def escape_regex(text: str) -> str:
    """Escape special regex characters."""
    return re.escape(text)


***REMOVED*** =============================================================================
***REMOVED*** Tool Definitions
***REMOVED*** =============================================================================


@tool
def bash(command: str, timeout: int = 120000) -> str:
    """Execute a shell command.

    Use for git operations, running scripts, installing packages, etc.
    Commands run in the working directory.

    Args:
        command: The shell command to execute
        timeout: Timeout in milliseconds (default: 120000, max: 600000)

    Returns:
        Command output with success/failure indication
    """
    max_timeout = 600000
    actual_timeout = min(timeout, max_timeout) / 1000  ***REMOVED*** Convert to seconds

    ***REMOVED*** Check for cached test results
    if is_test_command(command):
        cached = state_manager.get_cached_test(command)
        if cached:
            log(f"[bash] Returning cached test result for: {command[:50]}...")
            return f"{cached['output']}\n\n[Cached result - no file changes since last run]"

    log(f"[bash] Executing: {command}")

    try:
        result = subprocess.run(
            ["bash", "-c", command],
            cwd=WORKING_DIR,
            capture_output=True,
            text=True,
            timeout=actual_timeout,
            env={**os.environ},
        )

        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            output += ("\n" if output else "") + result.stderr

        success = result.returncode == 0
        log(f"[bash] Exit code: {result.returncode}")

        ***REMOVED*** Cache successful test results
        if is_test_command(command) and success:
            state_manager.cache_test_result(
                command,
                TestResult(success=True, output=output, timestamp=time.time()),
            )

        status = "Success" if success else "Failed"
        return f"[{status}] Exit code: {result.returncode}\n{output or 'No output'}"

    except subprocess.TimeoutExpired:
        return f"[Failed] Command timed out after {actual_timeout}s"
    except Exception as e:
        return f"[Failed] Error executing command: {e}"


@tool
def read_file(path: str, offset: int | None = None, limit: int | None = None) -> str:
    """Read the contents of a file.

    Returns the file content as text. Use this to examine source code,
    configuration files, etc.

    Args:
        path: Absolute or relative path to the file to read
        offset: Line number to start reading from (1-based)
        limit: Maximum number of lines to read

    Returns:
        File contents or error message
    """
    try:
        full_path = resolve_path(path)
        log(f"[read_file] Reading: {full_path}")

        if not full_path.exists():
            return f"[Failed] File not found: {full_path}"

        if full_path.is_dir():
            return f"[Failed] Path is a directory, not a file: {full_path}"

        content = full_path.read_text(encoding="utf-8")

        ***REMOVED*** Cache full file content for edit guidance (before applying offset/limit)
        state_manager.cache_file_content(str(full_path), content)

        ***REMOVED*** Apply offset and limit if specified
        if offset is not None or limit is not None:
            lines = content.split("\n")
            start_line = (offset or 1) - 1
            end_line = start_line + limit if limit else len(lines)
            content = "\n".join(lines[start_line:end_line])

        return f"[Success] Contents of {full_path}:\n{content}"

    except Exception as e:
        return f"[Failed] Error reading file: {e}"


@tool
def write_file(path: str, content: str) -> str:
    """Write content to a file.

    Creates the file if it doesn't exist, overwrites if it does.
    Creates parent directories as needed.

    Args:
        path: Absolute or relative path to the file to write
        content: The content to write to the file

    Returns:
        Success message or error
    """
    try:
        full_path = resolve_path(path)
        log(f"[write_file] Writing: {full_path}")

        ***REMOVED*** Create parent directories if needed
        full_path.parent.mkdir(parents=True, exist_ok=True)

        full_path.write_text(content, encoding="utf-8")

        ***REMOVED*** Invalidate test cache since files changed
        state_manager.mark_file_modified(str(full_path))

        return f"[Success] Wrote {len(content)} bytes to {full_path}"

    except Exception as e:
        return f"[Failed] Error writing file: {e}"


@tool
def edit_file(
    path: str,
    old_string: str,
    new_string: str,
    replace_all: bool = False,
) -> str:
    """Edit an existing file by replacing text.

    Use old_string to specify the exact text to find and new_string
    for the replacement. The old_string must match exactly (including whitespace).

    Args:
        path: Absolute or relative path to the file to edit
        old_string: The exact text to find and replace
        new_string: The text to replace it with
        replace_all: If true, replace all occurrences. If false, replace only the first.

    Returns:
        Success message with replacement count or error
    """
    try:
        full_path = resolve_path(path)
        log(f"[edit_file] Editing: {full_path}")

        if not full_path.exists():
            return f"[Failed] File not found: {full_path}"

        content = full_path.read_text(encoding="utf-8")

        if old_string not in content:
            return f"[Failed] Could not find the specified text in {full_path}. Make sure old_string matches exactly."

        if replace_all:
            ***REMOVED*** Count occurrences and replace all
            count = content.count(old_string)
            new_content = content.replace(old_string, new_string)
        else:
            ***REMOVED*** Replace only first occurrence
            count = 1
            new_content = content.replace(old_string, new_string, 1)

        full_path.write_text(new_content, encoding="utf-8")

        ***REMOVED*** Invalidate test cache since files changed
        state_manager.mark_file_modified(str(full_path))

        return f"[Success] Replaced {count} occurrence(s) in {full_path}"

    except Exception as e:
        return f"[Failed] Error editing file: {e}"


@tool
def glob(pattern: str, path: str | None = None) -> str:
    """Find files matching a glob pattern.

    Returns a list of matching file paths. Useful for discovering files
    before reading them.

    Properly handles directory paths in patterns:
    - "*.md" -> search current dir only
    - "directives/qa_engineer/*.md" -> search that specific directory only
    - "src/**/*.ts" -> recursively search src/ for .ts files

    Args:
        pattern: Glob pattern to match (e.g., "**/*.js", "src/**/*.ts")
        path: Directory to search in (default: current working directory)

    Returns:
        List of matching file paths or "No matching files found"
    """
    try:
        base_dir = resolve_path(path) if path else WORKING_DIR
        log(f"[glob] Searching for: {pattern} in {base_dir}")

        ***REMOVED*** Determine the appropriate find command based on pattern structure
        if "**" in pattern:
            ***REMOVED*** Recursive search pattern like "src/**/*.ts" or "**/*.md"
            parts = pattern.split("**")
            path_prefix = parts[0].rstrip("/")  ***REMOVED*** e.g., "src" from "src/**/*.ts"
            name_part = parts[1].lstrip("/") if len(parts) > 1 else "*"

            ***REMOVED*** Extract just the filename pattern
            if "/" in name_part:
                name = name_part.split("/")[-1]
            else:
                name = name_part

            search_dir = base_dir / path_prefix if path_prefix else base_dir
            find_cmd = f'find "{search_dir}" -type f -name "{name}" 2>/dev/null | head -500'

        elif "/" in pattern:
            ***REMOVED*** Pattern has directory component like "directives/qa_engineer/*.md"
            last_slash = pattern.rfind("/")
            dir_path = pattern[:last_slash]
            name = pattern[last_slash + 1 :]

            search_dir = base_dir / dir_path
            ***REMOVED*** Use maxdepth 1 since this is not a recursive pattern
            find_cmd = f'find "{search_dir}" -maxdepth 1 -type f -name "{name}" 2>/dev/null | head -500'

        else:
            ***REMOVED*** Just a filename pattern in current directory like "*.md"
            find_cmd = f'find "{base_dir}" -maxdepth 1 -type f -name "{pattern}" 2>/dev/null | head -500'

        log(f"[glob] Running: {find_cmd}")

        result = subprocess.run(
            ["bash", "-c", find_cmd],
            cwd=WORKING_DIR,
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.stdout.strip():
            files = [f for f in result.stdout.strip().split("\n") if f]
            log(f"[glob] Found {len(files)} files")
            return f"[Success] Found {len(files)} files:\n" + "\n".join(files)

        return "[Success] No matching files found"

    except subprocess.TimeoutExpired:
        return "[Failed] Search timed out"
    except Exception as e:
        return f"[Failed] Error in glob: {e}"


@tool
def grep(
    pattern: str,
    path: str | None = None,
    include: str | None = None,
    ignore_case: bool = False,
) -> str:
    """Search for a pattern in files.

    Returns matching lines with file paths and line numbers.
    Supports regular expressions.

    Args:
        pattern: Regular expression pattern to search for
        path: File or directory to search in (default: working directory)
        include: File pattern to include (e.g., "*.js")
        ignore_case: Case-insensitive search

    Returns:
        Matching lines with file paths and line numbers
    """
    try:
        target_path = resolve_path(path) if path else WORKING_DIR
        log(f"[grep] Searching for: {pattern} in {target_path}")

        grep_cmd = "grep -rn"
        if ignore_case:
            grep_cmd += " -i"
        if include:
            grep_cmd += f' --include="{include}"'

        grep_cmd += f' "{pattern}" "{target_path}" 2>/dev/null | head -100'

        result = subprocess.run(
            ["bash", "-c", grep_cmd],
            cwd=WORKING_DIR,
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.stdout.strip():
            return f"[Success] Matches found:\n{result.stdout}"

        return "[Success] No matches found"

    except subprocess.TimeoutExpired:
        return "[Failed] Search timed out"
    except Exception as e:
        return f"[Failed] Error in grep: {e}"


***REMOVED*** All tools for the agent
TOOLS = [bash, read_file, write_file, edit_file, glob, grep]


***REMOVED*** =============================================================================
***REMOVED*** System Prompt
***REMOVED*** =============================================================================

DEFAULT_SYSTEM_PROMPT = """You are an autonomous coding agent executing tasks for WorkerMill.

***REMOVED******REMOVED*** THINKING DISCIPLINE

Before EVERY action, think step-by-step:
1. What am I trying to accomplish right now?
2. What information do I need? Do I have it?
3. What is the minimal change needed?
4. What could go wrong? How will I verify success?

**Never act without understanding.** If unsure about file paths, read the directory first. If unsure about code structure, read the file first. If unsure about the task, re-read the requirements.

**Quality over speed.** It's better to take 10 iterations and succeed than to rush in 3 iterations and fail.

***REMOVED******REMOVED*** CRITICAL: YOUR FIRST ACTION

Your VERY FIRST tool call MUST be to add a Jira analysis comment. Use the bash tool like this:

bash(command='TICKET_KEY="$TICKET_KEY" COMMENT="🔍 **Analysis**: I will [describe your plan]" node /app/execution-compiled/ticket/add_comment.js')

The TICKET_KEY environment variable is already set. Do NOT skip this step.

**IMPORTANT**: In Jira comments, do NOT use backticks (\`) for code - bash interprets them as command substitution. Use single quotes or just describe the code without special formatting.

***REMOVED******REMOVED*** TOOLS AND THEIR PARAMETERS

You have these tools. Each tool call must use the EXACT parameter names shown:

1. **bash** - Run shell commands
   - Parameters: command (required), timeout (optional)
   - Example: bash(command="npm run build")

2. **glob** - Find files by pattern
   - Parameters: pattern (required), path (optional)
   - Example: glob(pattern="**/*.ts")
   - WRONG: glob(TICKET_KEY=...) - glob does NOT take TICKET_KEY!

3. **read_file** - Read file contents
   - Parameters: path (required), offset (optional), limit (optional)
   - Example: read_file(path="/workspace/repo/src/app.ts")

4. **write_file** - Create/overwrite files
   - Parameters: path (required), content (required)
   - Example: write_file(path="/workspace/repo/docs/audit.md", content="***REMOVED*** Report...")

5. **edit_file** - Search and replace in files
   - Parameters: path (required), old_string (required), new_string (required), replace_all (optional)
   - Example: edit_file(path="/workspace/repo/src/app.ts", old_string="foo", new_string="bar")
   - **CRITICAL**: ALWAYS read_file BEFORE using edit_file! You must see the exact content.

6. **grep** - Search file contents
   - Parameters: pattern (required), path (optional), include (optional), ignore_case (optional)
   - Example: grep(pattern="rateLimit", include="*.ts")

***REMOVED******REMOVED*** CRITICAL EDITING RULES

**ALWAYS read a file before editing it.** The edit_file tool requires old_string to match EXACTLY, including whitespace and indentation. If you edit without reading first, it will fail.

**CORRECT WORKFLOW:**
1. read_file(path="src/app.ts") → see the actual content
2. COPY the exact text you want to replace (including whitespace)
3. edit_file(path="src/app.ts", old_string="<exact text from step 1>", new_string="<replacement>")

**IF edit_file FAILS - FOLLOW THIS ESCALATION:**

| Failure ***REMOVED*** | Required Action |
|-----------|-----------------|
| 1st fail  | read_file() again to see current content, then retry edit_file with exact text |
| 2nd fail  | Read file, then either try edit_file ONE more time OR use write_file |
| 3rd fail  | STOP using edit_file. You MUST use write_file to rewrite the entire file |

**HOW TO USE write_file AS FALLBACK:**
1. read_file(path="file.ts") to get the complete current content
2. In your response, modify the content to include your changes
3. write_file(path="file.ts", content="<complete modified content>")

**IMPORTANT**: After 3 edit failures on a file, edit_file will be BLOCKED. The system will not execute it.

**Never guess what's in a file.** Always read first.

***REMOVED******REMOVED*** WORKFLOW: THINK → PLAN → ACT → VERIFY

Follow this disciplined workflow for EVERY task:

***REMOVED******REMOVED******REMOVED*** Phase 1: ANALYZE (Think before acting)
1. Add Jira analysis comment with your understanding of the task
2. Ask yourself: "What files need to change? What's the minimal change needed?"
3. Use glob to find candidate files, read_file to understand existing code
4. **STOP and THINK**: Write out your implementation plan before making changes

***REMOVED******REMOVED******REMOVED*** Phase 2: IMPLEMENT (Draft → Review → Final)
For EACH file you modify, follow this loop:

**DRAFT:**
- Read the file first (ALWAYS)
- Make your edit_file or write_file change

**REVIEW (after each change):**
- Re-read the file to verify your change applied correctly
- Check: Are imports correct? Are paths correct? Is syntax valid?
- Check: Did I change the RIGHT file? (not a similarly-named one)

**FINAL:**
- If review found issues → fix them immediately
- If review passed → move to next file

***REMOVED******REMOVED******REMOVED*** Phase 3: VERIFY (Build & Test)
1. Run the build: bash(command="npm run build") or equivalent
2. Run tests if available: bash(command="npm test")
3. Run linting: bash(command="npm run lint")
4. **If any fail**: Read the error, fix the issue, re-verify

***REMOVED******REMOVED******REMOVED*** Phase 4: COMMIT & PR
1. Stage changes: bash(command="git add -A")
2. Commit with descriptive message: bash(command="git commit -m '[type]: description'")
3. Push to branch: bash(command="git push origin HEAD")
4. Create PR: bash(command="gh pr create --title '...' --body '...'")

***REMOVED******REMOVED******REMOVED*** Phase 5: SELF-REVIEW (Critical!)
**Before marking complete, perform this mandatory review:**

Ask yourself these questions and FIX any issues found:

| Check | Question |
|-------|----------|
| ✅ Changes Made? | Did I actually make code changes, or just plan them? |
| ✅ Right Files? | Did I modify the CORRECT files? (check paths carefully) |
| ✅ Right Directories? | frontend/src vs src? api/src vs src? |
| ✅ Imports Added? | Did I add all required import statements? |
| ✅ Build Passes? | Does `npm run build` succeed? |
| ✅ Committed? | Did I git add, commit, AND push? |
| ✅ PR Created? | Did I create the pull request? |
| ✅ Nothing Missing? | Re-read the ticket - did I miss any requirements? |

**If ANY check fails**: Go back and fix it before completing.

***REMOVED******REMOVED******REMOVED*** Phase 6: COMPLETE
**Only after ALL self-review checks pass**, add completion comment:
bash(command='TICKET_KEY="$TICKET_KEY" COMMENT="✅ **Completed**: [summary of changes]" node /app/execution-compiled/ticket/add_comment.js')

Then output these markers in your final response:
- ::result::review_requested (if PR created)
- ::result::deployed (if deployed)
- ::result::failed (if unable to complete)
- ::pr_url::https://github.com/... (the PR URL)

***REMOVED******REMOVED*** RULES

- ONE tool call at a time, wait for result
- Use glob BEFORE read_file to find correct paths
- Use read_file BEFORE edit_file to get exact content
- Do NOT read directories - use glob first
- Stay focused on the task - don't add unrelated changes
- Maximum 3 edit attempts per file, then use write_file or move on
- Follow the detailed AGENTS.md instructions in the task prompt"""


***REMOVED*** =============================================================================
***REMOVED*** Token Counter (for cost tracking)
***REMOVED*** =============================================================================


class TokenCounter:
    """Track token usage across agent iterations."""

    def __init__(self):
        self.input_tokens = 0
        self.output_tokens = 0

    def add(self, input_tokens: int = 0, output_tokens: int = 0) -> None:
        """Add token counts."""
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens


token_counter = TokenCounter()


***REMOVED*** =============================================================================
***REMOVED*** Custom State Modifier
***REMOVED*** =============================================================================


def state_modifier(state: AgentState) -> list[BaseMessage]:
    """Modify state before each agent iteration.

    This function is called before each LLM invocation and can:
    - Add context about test cache status
    - Inject iteration warnings
    - Provide modified file summaries
    """
    messages = state["messages"]
    iteration = state.get("iteration", 0)

    ***REMOVED*** Add iteration warning if getting close to limit
    if iteration > MAX_ITERATIONS * 0.8:
        remaining = MAX_ITERATIONS - iteration
        messages = messages + [
            SystemMessage(
                content=f"WARNING: Only {remaining} iterations remaining. Please wrap up your work."
            )
        ]

    return messages


***REMOVED*** =============================================================================
***REMOVED*** JSON Tool Call Parser (for models that output JSON instead of native tool_calls)
***REMOVED*** =============================================================================


def parse_json_tool_calls(content: str) -> list[dict]:
    """Parse JSON tool calls from model response content.

    Some models (like Qwen) output tool calls as JSON blocks in their
    response content instead of using native function calling.

    Example formats detected:
    ```json
    {"name": "glob", "arguments": {"pattern": "*.ts"}}
    ```

    Or inline:
    glob(pattern="*.ts")

    Args:
        content: The model's response content

    Returns:
        List of parsed tool calls with "name" and "args" keys
    """
    import json

    tool_calls = []

    ***REMOVED*** Pattern 1: JSON code blocks with tool call format
    ***REMOVED*** Matches ```json { "name": "tool", "arguments": {...} } ```
    json_block_pattern = r'```(?:json)?\s*(\{[^`]*?"name"\s*:\s*"[^"]+"\s*[^`]*?\})\s*```'
    json_matches = re.findall(json_block_pattern, content, re.DOTALL | re.IGNORECASE)

    for match in json_matches:
        try:
            parsed = json.loads(match.strip())
            if "name" in parsed:
                tool_name = parsed.get("name")
                ***REMOVED*** Handle both "arguments" and "args" keys
                tool_args = parsed.get("arguments") or parsed.get("args") or {}
                tool_calls.append({"name": tool_name, "args": tool_args})
        except json.JSONDecodeError:
            pass  ***REMOVED*** Skip invalid JSON

    ***REMOVED*** Pattern 2: Inline JSON without code blocks (fallback)
    ***REMOVED*** Matches { "name": "tool", "arguments": {...} } not in code blocks
    if not tool_calls:
        inline_pattern = r'\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]+\})\s*\}'
        inline_matches = re.findall(inline_pattern, content)
        for name, args_str in inline_matches:
            try:
                args = json.loads(args_str)
                tool_calls.append({"name": name, "args": args})
            except json.JSONDecodeError:
                pass

    ***REMOVED*** Pattern 3: Function call syntax like tool_name(arg="value")
    ***REMOVED*** Matches: bash(command="ls -la") or glob(pattern="*.ts")
    if not tool_calls:
        func_pattern = r'\b(bash|read_file|write_file|edit_file|glob|grep)\s*\(\s*([^)]+)\s*\)'
        func_matches = re.findall(func_pattern, content)
        for tool_name, args_str in func_matches:
            try:
                ***REMOVED*** Parse keyword arguments like: command="ls", timeout=30
                args = {}
                ***REMOVED*** Match key="value" or key=value patterns
                kv_pattern = r'(\w+)\s*=\s*(?:"([^"]*?)"|\'([^\']*?)\'|([^\s,)]+))'
                for kv_match in re.findall(kv_pattern, args_str):
                    key = kv_match[0]
                    ***REMOVED*** Value is in one of the capture groups
                    value = kv_match[1] or kv_match[2] or kv_match[3]
                    args[key] = value
                if args:
                    tool_calls.append({"name": tool_name, "args": args})
            except Exception:
                pass

    return tool_calls


***REMOVED*** =============================================================================
***REMOVED*** Agent Execution
***REMOVED*** =============================================================================


def create_llm(provider: str, model_name: str):
    """Create the appropriate LLM based on provider.

    Supports multiple AI providers via LangChain integrations.

    Args:
        provider: Provider name (ollama, openai, gemini, groq, mistral, azure)
        model_name: Model name to use

    Returns:
        Configured LLM instance

    Raises:
        ValueError: If provider is not supported
        ImportError: If required provider package is not installed
    """
    provider = provider.lower()

    ***REMOVED*** Legacy vLLM support (OpenAI-compatible endpoint)
    if VLLM_BASE_URL and provider == "ollama":
        log(f"[llm] Using vLLM at {VLLM_BASE_URL}")
        return ChatOpenAI(
            model=model_name,
            base_url=f"{VLLM_BASE_URL}/v1",
            api_key="not-needed",
            max_tokens=4096,
        )

    if provider == "ollama":
        log(f"[llm] Using Ollama at {OLLAMA_HOST}")
        return ChatOllama(
            model=model_name,
            base_url=OLLAMA_HOST,
            num_predict=4096,
            num_ctx=262144,  ***REMOVED*** 256K context window
        )

    elif provider == "openai":
        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY environment variable is required for OpenAI provider")
        log(f"[llm] Using OpenAI with model {model_name}")
        return ChatOpenAI(
            model=model_name,
            api_key=OPENAI_API_KEY,
            max_tokens=4096,
        )

    elif provider in ("gemini", "google"):
        if not GOOGLE_API_KEY:
            raise ValueError("GOOGLE_API_KEY environment variable is required for Gemini provider")
        ChatGoogleGenerativeAI = _get_chat_google()
        log(f"[llm] Using Google Gemini with model {model_name}")
        return ChatGoogleGenerativeAI(
            model=model_name,
            google_api_key=GOOGLE_API_KEY,
            max_output_tokens=4096,
        )

    elif provider == "groq":
        if not GROQ_API_KEY:
            raise ValueError("GROQ_API_KEY environment variable is required for Groq provider")
        ChatGroq = _get_chat_groq()
        log(f"[llm] Using Groq with model {model_name}")
        return ChatGroq(
            model=model_name,
            api_key=GROQ_API_KEY,
            max_tokens=4096,
        )

    elif provider == "mistral":
        if not MISTRAL_API_KEY:
            raise ValueError("MISTRAL_API_KEY environment variable is required for Mistral provider")
        ChatMistralAI = _get_chat_mistral()
        log(f"[llm] Using Mistral with model {model_name}")
        return ChatMistralAI(
            model=model_name,
            api_key=MISTRAL_API_KEY,
            max_tokens=4096,
        )

    elif provider == "azure":
        if not AZURE_API_KEY or not AZURE_API_BASE:
            raise ValueError(
                "AZURE_API_KEY and AZURE_API_BASE environment variables are required for Azure provider"
            )
        AzureChatOpenAI = _get_azure_chat_openai()
        log(f"[llm] Using Azure OpenAI with deployment {model_name}")
        return AzureChatOpenAI(
            azure_deployment=model_name,
            api_key=AZURE_API_KEY,
            azure_endpoint=AZURE_API_BASE,
            api_version=AZURE_API_VERSION,
            max_tokens=4096,
        )

    elif provider in ("xai", "grok"):
        ***REMOVED*** xAI's Grok - uses OpenAI-compatible API
        if not XAI_API_KEY:
            raise ValueError("XAI_API_KEY environment variable is required for Grok/xAI provider")
        log(f"[llm] Using xAI Grok with model {model_name}")
        return ChatOpenAI(
            model=model_name,
            api_key=XAI_API_KEY,
            base_url="https://api.x.ai/v1",
            max_tokens=4096,
        )

    else:
        supported = ", ".join(PROVIDER_DEFAULTS.keys())
        raise ValueError(f"Unsupported provider: {provider}. Supported: {supported}")


def create_agent(provider: str, model_name: str, system_prompt: str | None = None):
    """Create the LangGraph ReAct agent.

    Args:
        provider: AI provider (ollama, openai, gemini, groq, mistral, azure)
        model_name: Model name (e.g., "llama3.1:8b", "gpt-4o", "gemini-1.5-pro")
        system_prompt: Optional custom system prompt

    Returns:
        Configured LangGraph agent
    """
    ***REMOVED*** Initialize LLM for the specified provider
    llm = create_llm(provider, model_name)

    ***REMOVED*** Create the ReAct agent using LangGraph (simplified API for v1.0+)
    ***REMOVED*** Note: state_modifier and state_schema are no longer supported
    ***REMOVED*** Use messages_modifier for system prompt injection instead
    prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
    agent = create_react_agent(
        model=llm,
        tools=TOOLS,
        messages_modifier=prompt,
    )

    return agent


def run_agent(
    prompt: str,
    provider: str,
    model_name: str,
    system_prompt: str | None = None,
) -> str:
    """Run the autonomous agent loop.

    Args:
        prompt: The task prompt
        provider: AI provider (ollama, openai, gemini, groq, mistral, azure)
        model_name: Model name for the provider
        system_prompt: Optional custom system prompt

    Returns:
        Final agent response content
    """
    print(f"\n{'=' * 60}")
    print("LangGraph ReAct Executor Starting")
    print(f"Provider: {provider}")
    print(f"Model: {model_name}")
    print(f"Working Directory: {WORKING_DIR}")
    print(f"Max Iterations: {MAX_ITERATIONS}")
    print(f"{'=' * 60}\n")

    ***REMOVED*** Create agent
    agent = create_agent(provider, model_name, system_prompt)

    ***REMOVED*** Build initial messages
    messages: list[BaseMessage] = []

    if system_prompt:
        messages.append(SystemMessage(content=system_prompt))
    else:
        messages.append(SystemMessage(content=DEFAULT_SYSTEM_PROMPT))

    messages.append(HumanMessage(content=prompt))

    ***REMOVED*** Create initial state (LangGraph v1.0+ uses simple messages dict)
    state = {
        "messages": messages,
    }

    final_content = ""
    iteration = 0

    try:
        ***REMOVED*** Stream through agent execution
        for event in agent.stream(state, stream_mode="values"):
            iteration += 1

            if iteration > MAX_ITERATIONS:
                print(f"\n{MARKERS['ERROR']}Max iterations ({MAX_ITERATIONS}) reached")
                break

            print(f"\n--- Iteration {iteration}/{MAX_ITERATIONS} ---\n")

            ***REMOVED*** Get the latest messages
            if "messages" in event:
                for msg in event["messages"]:
                    if isinstance(msg, AIMessage):
                        if msg.content:
                            ***REMOVED*** Normalize content if it's a list
                            content_str = msg.content
                            if isinstance(content_str, list):
                                parts = []
                                for part in content_str:
                                    if isinstance(part, str):
                                        parts.append(part)
                                    elif isinstance(part, dict) and "text" in part:
                                        parts.append(part["text"])
                                    else:
                                        parts.append(str(part))
                                content_str = "\n".join(parts)

                            print(f"\nAssistant: {content_str}\n")
                            final_content = content_str

                        ***REMOVED*** Log tool calls
                        if hasattr(msg, "tool_calls") and msg.tool_calls:
                            for tc in msg.tool_calls:
                                print(f"\n[Tool] {tc['name']}({tc['args']})\n")

            ***REMOVED*** Check for completion markers
            if final_content:
                content_lower = final_content.lower()
                completion_markers = [
                    "::result::",
                    "task complete",
                    "i have completed",
                    "i've completed",
                    "changes have been made",
                    "pr has been created",
                    "pull request created",
                    "no changes needed",
                    "no changes required",
                    "nothing to change",
                ]
                if any(marker in content_lower for marker in completion_markers):
                    print("\n--- Agent Complete (explicit) ---\n")
                    break

    except KeyboardInterrupt:
        print("\n\nAgent interrupted by user")
    except Exception as e:
        print(f"\n{MARKERS['ERROR']}{e}")
        raise

    ***REMOVED*** Extract and print markers
    extract_markers(final_content)

    ***REMOVED*** Output token usage markers
    if token_counter.input_tokens > 0 or token_counter.output_tokens > 0:
        print(f"\n{MARKERS['INPUT_TOKENS']}{token_counter.input_tokens}")
        print(f"{MARKERS['OUTPUT_TOKENS']}{token_counter.output_tokens}")

    return final_content


def is_placeholder_url(url: str) -> tuple[bool, str]:
    """Check if a URL looks like a placeholder/hallucinated URL.

    Returns (is_placeholder, reason).
    """
    url_lower = url.lower()

    ***REMOVED*** Common placeholder patterns
    if "owner/repo" in url_lower or "/owner/" in url_lower:
        return True, "contains 'owner/repo' - a common placeholder"
    if "your-" in url_lower or "my-repo" in url_lower or "test-repo" in url_lower:
        return True, "contains generic placeholder name"
    if "example" in url_lower or "placeholder" in url_lower:
        return True, "contains 'example' or 'placeholder'"
    if url.endswith("/pull/123"):
        return True, "ends with /pull/123 - a common example PR number"

    return False, ""


def extract_markers(content: str) -> None:
    """Extract WorkerMill markers from content."""
    if not content:
        return

    ***REMOVED*** Check for result markers
    result_match = re.search(r"::result::(\w+)", content)
    if result_match:
        print(f"\n{MARKERS['RESULT']}{result_match.group(1)}")

    ***REMOVED*** Check for PR URL
    pr_match = re.search(r"::pr_url::(https?://\S+)", content)
    if pr_match:
        pr_url = pr_match.group(1)
        is_fake, reason = is_placeholder_url(pr_url)
        if is_fake:
            print(f"\n[error] Model output PLACEHOLDER PR URL: {pr_url}")
            print(f"[error] Reason: {reason}")
            print(f"[error] The model hallucinated this URL - no PR was actually created")
        ***REMOVED*** Still output the marker so entrypoint.sh can handle it appropriately
        print(f"\n{MARKERS['PR_URL']}{pr_url}")

    ***REMOVED*** Check for cost info
    cost_match = re.search(r"::cost::(\d+\.?\d*)", content)
    if cost_match:
        print(f"\n{MARKERS['COST']}{cost_match.group(1)}")


***REMOVED*** =============================================================================
***REMOVED*** Alternative: Manual ReAct Loop (for more control)
***REMOVED*** =============================================================================


def run_agent_manual(
    prompt: str,
    provider: str,
    model_name: str,
    system_prompt: str | None = None,
) -> str:
    """Run agent with manual ReAct loop for finer control.

    This implementation gives more control over the agent loop,
    allowing for custom logic at each step.

    Args:
        prompt: The task prompt
        provider: AI provider (ollama, openai, gemini, groq, mistral, azure)
        model_name: Model name for the provider
        system_prompt: Optional custom system prompt

    Returns:
        Final agent response content
    """
    print(f"\n{'=' * 60}")
    print("LangGraph ReAct Executor (Manual Loop)")
    print(f"Provider: {provider}")
    print(f"Model: {model_name}")
    print(f"Working Directory: {WORKING_DIR}")
    print(f"Max Iterations: {MAX_ITERATIONS}")
    print(f"{'=' * 60}\n")

    ***REMOVED*** Initialize LLM with tools bound for the specified provider
    llm = create_llm(provider, model_name)
    llm_with_tools = llm.bind_tools(TOOLS)

    ***REMOVED*** Build conversation
    messages: list[BaseMessage] = []

    if system_prompt:
        messages.append(SystemMessage(content=system_prompt))
    else:
        messages.append(SystemMessage(content=DEFAULT_SYSTEM_PROMPT))

    messages.append(HumanMessage(content=prompt))

    final_content = ""
    iteration = 0

    ***REMOVED*** Tool name to function mapping
    tool_map = {
        "bash": bash,
        "read_file": read_file,
        "write_file": write_file,
        "edit_file": edit_file,
        "glob": glob,
        "grep": grep,
    }

    while iteration < MAX_ITERATIONS:
        iteration += 1
        print(f"\n--- Iteration {iteration}/{MAX_ITERATIONS} ---\n")

        try:
            ***REMOVED*** Invoke LLM
            response = llm_with_tools.invoke(messages)

            ***REMOVED*** Normalize response.content if it is a list (e.g. Anthropic, OpenAI multi-modal)
            ***REMOVED*** This prevents "expected string or bytes-like object, got 'list'" errors
            if isinstance(response.content, list):
                parts = []
                for part in response.content:
                    if isinstance(part, str):
                        parts.append(part)
                    elif isinstance(part, dict) and "text" in part:
                        parts.append(part["text"])
                    else:
                        parts.append(str(part))
                response.content = "\n".join(parts)

            messages.append(response)

            ***REMOVED*** Track token usage from response metadata
            if hasattr(response, "usage_metadata") and response.usage_metadata:
                usage = response.usage_metadata
                input_tokens = usage.get("input_tokens", 0)
                output_tokens = usage.get("output_tokens", 0)
                token_counter.add(input_tokens, output_tokens)
                log(f"[tokens] This turn: input={input_tokens}, output={output_tokens}")

            ***REMOVED*** Print response content
            if response.content:
                print(f"\nAssistant: {response.content}\n")
                final_content = response.content

            ***REMOVED*** Check for tool calls
            if hasattr(response, "tool_calls") and response.tool_calls:
                for tc in response.tool_calls:
                    tool_name = tc["name"]
                    tool_args = tc["args"]
                    tool_id = tc.get("id", f"call_{iteration}")

                    print(f"\n[Tool] {tool_name}({tool_args})\n")

                    ***REMOVED*** Execute tool
                    tool_fn = tool_map.get(tool_name)
                    if tool_fn:
                        try:
                            result = tool_fn.invoke(tool_args)
                            ***REMOVED*** Truncate long outputs
                            if len(result) > 50000:
                                result = (
                                    result[:25000]
                                    + "\n\n... [output truncated] ...\n\n"
                                    + result[-25000:]
                                )
                            print(f"[Result] {result[:500]}{'...' if len(result) > 500 else ''}\n")

                            ***REMOVED*** Check for bash command loops (e.g., retrying same Jira comment)
                            if tool_name == "bash":
                                command = tool_args.get("command", "")
                                is_loop, loop_guidance, force_stop = state_manager.check_bash_loop(command)
                                if is_loop:
                                    if force_stop:
                                        print(f"\n[System] ⚠️ CRITICAL LOOP DETECTED - forcing model to stop this action\n")
                                        ***REMOVED*** Clear recent commands to reset detection
                                        state_manager.recent_bash_commands.clear()
                                        ***REMOVED*** Inject a very strong message to break the loop
                                        messages.append(
                                            ToolMessage(content="LOOP DETECTED - Result suppressed. See system guidance below.", tool_call_id=tool_id)
                                        )
                                        messages.append(
                                            HumanMessage(content=f"[CRITICAL SYSTEM INTERVENTION]:\n\n{loop_guidance}")
                                        )
                                    else:
                                        print(f"[System] Detected command loop - injecting guidance\n")
                                        messages.append(
                                            ToolMessage(content=result, tool_call_id=tool_id)
                                        )
                                        messages.append(
                                            HumanMessage(content=f"[SYSTEM GUIDANCE]: {loop_guidance}")
                                        )
                                    continue  ***REMOVED*** Skip normal tool result append

                            ***REMOVED*** Track edit_file failures and inject guidance
                            if tool_name == "edit_file":
                                filepath = tool_args.get("path", "")
                                old_string = tool_args.get("old_string", "")
                                new_string = tool_args.get("new_string", "")

                                ***REMOVED*** Check if we should block this edit (too many failures)
                                current_failures = state_manager.edit_failures.get(filepath, 0)
                                if current_failures >= 3:
                                    ***REMOVED*** Block the edit and force alternative action
                                    block_msg = (
                                        f"[BLOCKED] edit_file on {filepath} has been blocked after {current_failures} failures.\n"
                                        f"You MUST use write_file() instead, or skip this file entirely.\n"
                                        f"Do NOT attempt edit_file on this file again."
                                    )
                                    print(f"[System] Blocking edit_file - too many failures ({current_failures})\n")
                                    messages.append(
                                        ToolMessage(content=block_msg, tool_call_id=tool_id)
                                    )
                                    continue  ***REMOVED*** Skip executing the tool

                                if "[Failed]" in result and "Could not find" in result:
                                    failure_count = state_manager.record_edit_failure(filepath, old_string, new_string)
                                    guidance = state_manager.get_edit_guidance(filepath, failure_count)
                                    print(f"[System] Edit failure ***REMOVED***{failure_count} - injecting guidance\n")
                                    ***REMOVED*** Inject guidance after the tool result
                                    messages.append(
                                        ToolMessage(content=result, tool_call_id=tool_id)
                                    )
                                    messages.append(
                                        HumanMessage(content=f"[SYSTEM GUIDANCE]: {guidance}")
                                    )
                                    continue  ***REMOVED*** Skip normal tool result append
                                elif "[Success]" in result:
                                    ***REMOVED*** Clear failure count on success
                                    state_manager.clear_edit_failures(filepath)

                        except Exception as e:
                            result = f"[Failed] Error executing tool: {e}"
                            print(f"[Result] {result}\n")
                    else:
                        result = f"[Failed] Unknown tool: {tool_name}"
                        print(f"[Result] {result}\n")

                    ***REMOVED*** Add tool result to messages
                    messages.append(
                        ToolMessage(content=result, tool_call_id=tool_id)
                    )
            else:
                ***REMOVED*** No native tool calls - check for JSON tool calls in content
                content = response.content or ""
                parsed_tools = parse_json_tool_calls(content)

                if parsed_tools:
                    ***REMOVED*** Execute parsed JSON tool calls
                    print(f"\n[System] Parsed {len(parsed_tools)} tool call(s) from JSON in response\n")
                    for tc in parsed_tools:
                        tool_name = tc["name"]
                        tool_args = tc["args"]
                        tool_id = f"parsed_{iteration}_{tool_name}"

                        print(f"\n[Tool] {tool_name}({tool_args})\n")

                        ***REMOVED*** Execute tool
                        tool_fn = tool_map.get(tool_name)
                        if tool_fn:
                            try:
                                result = tool_fn.invoke(tool_args)
                                ***REMOVED*** Truncate long outputs
                                if len(result) > 50000:
                                    result = (
                                        result[:25000]
                                        + "\n\n... [output truncated] ...\n\n"
                                        + result[-25000:]
                                    )
                                print(f"[Result] {result[:500]}{'...' if len(result) > 500 else ''}\n")
                            except Exception as e:
                                result = f"[Failed] Error executing tool: {e}"
                                print(f"[Result] {result}\n")
                        else:
                            result = f"[Failed] Unknown tool: {tool_name}"
                            print(f"[Result] {result}\n")

                        ***REMOVED*** Add tool result to messages
                        messages.append(
                            ToolMessage(content=result, tool_call_id=tool_id)
                        )
                    continue  ***REMOVED*** Continue the loop after executing parsed tools

                ***REMOVED*** No tool calls at all - check if done
                content_lower = content.lower()

                ***REMOVED*** Check for completion markers
                completion_markers = [
                    "::result::",
                    "task complete",
                    "i have completed",
                    "i've completed",
                    "changes have been made",
                    "pr has been created",
                    "pull request created",
                    "no changes needed",
                    "no changes required",
                    "nothing to change",
                ]
                if any(marker in content_lower for marker in completion_markers):
                    print("\n--- Agent Complete (explicit) ---\n")
                    break

                ***REMOVED*** Check for planning language (not done yet)
                planning_phrases = [
                    "let me",
                    "i'll ",
                    "i will",
                    "first,",
                    "next,",
                    "now let",
                    "let's ",
                ]
                if any(phrase in content_lower for phrase in planning_phrases):
                    ***REMOVED*** Model is planning - prompt it to take action
                    print("\n[System] Model is planning without action - prompting to continue...\n")
                    messages.append(
                        HumanMessage(
                            content=(
                                "Please proceed with your plan. Use the available tools "
                                "(bash, read_file, write_file, edit_file, glob, grep) to take action. "
                                "Don't just describe what you'll do - actually do it."
                            )
                        )
                    )
                else:
                    ***REMOVED*** No tool calls and not planning - probably done
                    print("\n--- Agent Complete (no more actions) ---\n")
                    break

        except Exception as e:
            print(f"\n{MARKERS['ERROR']}{e}")

            ***REMOVED*** Try to continue with error context
            messages.append(
                HumanMessage(
                    content=f"An error occurred: {e}. Please try a different approach."
                )
            )

            ***REMOVED*** Bail out if too many errors
            error_count = sum(
                1 for m in messages
                if isinstance(m, HumanMessage) and "An error occurred" in (m.content or "")
            )
            if iteration > 3 and error_count > 3:
                print("\nToo many errors, stopping agent.")
                break

    if iteration >= MAX_ITERATIONS:
        print(f"\n{MARKERS['ERROR']}Max iterations ({MAX_ITERATIONS}) reached")

    ***REMOVED*** Extract and print markers
    extract_markers(final_content)

    ***REMOVED*** Output token usage markers
    print(f"\n{MARKERS['INPUT_TOKENS']}{token_counter.input_tokens}")
    print(f"{MARKERS['OUTPUT_TOKENS']}{token_counter.output_tokens}")
    print(f"::cache_creation_tokens::0")
    print(f"::cache_read_tokens::0")
    print(f"::model::{model_name}")

    return final_content


***REMOVED*** =============================================================================
***REMOVED*** CLI Interface
***REMOVED*** =============================================================================


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="LangGraph ReAct Executor for WorkerMill - Unified Multi-Provider Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  ***REMOVED*** Ollama (default)
  python langgraph-executor.py --model llama3.1:8b --prompt "Fix the bug"

  ***REMOVED*** OpenAI
  python langgraph-executor.py --provider openai --model gpt-4o --prompt "Fix the bug"

  ***REMOVED*** Google Gemini
  python langgraph-executor.py --provider gemini --model gemini-1.5-pro --prompt "Fix the bug"

  ***REMOVED*** Groq (fast inference)
  python langgraph-executor.py --provider groq --model llama-3.1-70b-versatile --prompt "Fix the bug"

Environment Variables:
  WORKER_PROVIDER       AI provider (default: ollama)
  OLLAMA_HOST           Ollama server URL (default: http://localhost:11434)
  OPENAI_API_KEY        OpenAI API key (for openai provider)
  GOOGLE_API_KEY        Google API key (for gemini provider)
  GROQ_API_KEY          Groq API key (for groq provider)
  MISTRAL_API_KEY       Mistral API key (for mistral provider)
  AZURE_API_KEY         Azure OpenAI API key (for azure provider)
  AZURE_API_BASE        Azure OpenAI endpoint URL (for azure provider)
  AGENT_WORKING_DIR     Working directory (default: cwd)
  AGENT_MAX_ITERATIONS  Max iterations (default: 100)
  AGENT_VERBOSE         Enable verbose logging (true/false)
        """,
    )

    parser.add_argument(
        "--provider", "-p",
        type=str,
        default=None,
        choices=["ollama", "openai", "gemini", "google", "groq", "mistral", "xai", "grok", "azure"],
        help="AI provider (default: from WORKER_PROVIDER env var or 'ollama')",
    )
    parser.add_argument(
        "--model", "-m",
        type=str,
        default=None,
        help="Model name (default: provider-specific default)",
    )
    parser.add_argument(
        "--prompt",
        type=str,
        help="Task prompt",
    )
    parser.add_argument(
        "--prompt-file",
        type=str,
        help="Read prompt from file",
    )
    parser.add_argument(
        "--system",
        type=str,
        help="Custom system prompt",
    )
    parser.add_argument(
        "--stream",
        action="store_true",
        help="Use LangGraph stream mode instead of manual ReAct loop",
    )
    parser.add_argument(
        "prompt_positional",
        nargs="?",
        help="Task prompt (positional argument)",
    )

    return parser.parse_args()


def main() -> None:
    """Main entry point."""
    args = parse_args()

    ***REMOVED*** Determine provider (CLI arg > env var > default)
    provider = args.provider or WORKER_PROVIDER

    ***REMOVED*** Determine model (CLI arg > provider default)
    model = args.model or PROVIDER_DEFAULTS.get(provider, "llama3.1:8b")

    ***REMOVED*** Determine prompt
    prompt = args.prompt or args.prompt_positional

    if args.prompt_file and not prompt:
        try:
            prompt = Path(args.prompt_file).read_text(encoding="utf-8").strip()
        except Exception as e:
            print(f"Error reading prompt file: {e}", file=sys.stderr)
            sys.exit(1)

    if not prompt:
        print("Error: No prompt provided. Use --prompt or pass as argument.", file=sys.stderr)
        print("Use --help for usage information.", file=sys.stderr)
        sys.exit(1)

    try:
        ***REMOVED*** Choose execution mode (manual loop is default for better control)
        if args.stream:
            run_agent(prompt, provider, model, args.system)
        else:
            run_agent_manual(prompt, provider, model, args.system)
        sys.exit(0)
    except Exception as e:
        print(f"\n{MARKERS['ERROR']}{e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
