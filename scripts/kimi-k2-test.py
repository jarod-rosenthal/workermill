***REMOVED***!/usr/bin/env python3
"""
Test Kimi K2 tool calling capabilities.
Run this after the vLLM server is ready.

Usage:
    python3 kimi-k2-test.py <server_ip>
"""

import sys
import json
from openai import OpenAI

def test_tool_calling(base_url: str):
    """Test Kimi K2's tool calling with a simple coding task."""

    client = OpenAI(
        base_url=f"{base_url}/v1",
        api_key="not-needed"  ***REMOVED*** vLLM doesn't require auth
    )

    ***REMOVED*** Define tools similar to what our worker uses
    tools = [
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read the contents of a file",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "The path to the file to read"
                        }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Write content to a file",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "The path to write to"
                        },
                        "content": {
                            "type": "string",
                            "description": "The content to write"
                        }
                    },
                    "required": ["path", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "bash",
                "description": "Execute a bash command",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The command to execute"
                        }
                    },
                    "required": ["command"]
                }
            }
        }
    ]

    ***REMOVED*** Test 1: Simple tool call
    print("=" * 60)
    print("TEST 1: Simple tool call")
    print("=" * 60)

    response = client.chat.completions.create(
        model="RedHatAI/Kimi-K2-Instruct-quantized.w4a16",
        messages=[
            {"role": "system", "content": "You are a coding assistant. Use the provided tools to complete tasks."},
            {"role": "user", "content": "Read the file at /app/src/index.ts"}
        ],
        tools=tools,
        tool_choice="auto",
        temperature=0.6
    )

    print(f"Response: {response.choices[0].message}")

    if response.choices[0].message.tool_calls:
        print("\n✅ Tool call detected!")
        for tc in response.choices[0].message.tool_calls:
            print(f"  - Function: {tc.function.name}")
            print(f"  - Arguments: {tc.function.arguments}")
    else:
        print("\n❌ No tool call - model responded with text only")
        print(f"  Content: {response.choices[0].message.content}")

    ***REMOVED*** Test 2: Multi-step task
    print("\n" + "=" * 60)
    print("TEST 2: Multi-step coding task")
    print("=" * 60)

    response = client.chat.completions.create(
        model="RedHatAI/Kimi-K2-Instruct-quantized.w4a16",
        messages=[
            {"role": "system", "content": "You are a coding assistant. Use the provided tools to complete tasks. Always use tools - do not just describe what you would do."},
            {"role": "user", "content": "Create a new file at /app/src/utils/logger.ts with a simple logger function that logs messages with timestamps."}
        ],
        tools=tools,
        tool_choice="auto",
        temperature=0.6
    )

    print(f"Response: {response.choices[0].message}")

    if response.choices[0].message.tool_calls:
        print("\n✅ Tool call detected!")
        for tc in response.choices[0].message.tool_calls:
            print(f"  - Function: {tc.function.name}")
            args = json.loads(tc.function.arguments)
            print(f"  - Arguments: {json.dumps(args, indent=4)}")
    else:
        print("\n❌ No tool call - model responded with text only")
        print(f"  Content: {response.choices[0].message.content[:500]}...")

    ***REMOVED*** Test 3: Check performance
    print("\n" + "=" * 60)
    print("TEST 3: Performance check")
    print("=" * 60)

    import time
    start = time.time()

    response = client.chat.completions.create(
        model="RedHatAI/Kimi-K2-Instruct-quantized.w4a16",
        messages=[
            {"role": "user", "content": "What is 2 + 2?"}
        ],
        max_tokens=50
    )

    elapsed = time.time() - start
    output_tokens = response.usage.completion_tokens if response.usage else 0

    print(f"Response: {response.choices[0].message.content}")
    print(f"Time: {elapsed:.2f}s")
    print(f"Output tokens: {output_tokens}")
    if elapsed > 0 and output_tokens > 0:
        print(f"Speed: {output_tokens / elapsed:.1f} tok/s")

    print("\n" + "=" * 60)
    print("Testing complete!")
    print("=" * 60)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 kimi-k2-test.py <server_ip>")
        print("Example: python3 kimi-k2-test.py 54.123.45.67")
        sys.exit(1)

    server_ip = sys.argv[1]
    base_url = f"http://{server_ip}:8000"

    print(f"Testing Kimi K2 at {base_url}")
    test_tool_calling(base_url)
