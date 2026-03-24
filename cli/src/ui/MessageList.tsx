import React from "react";
import { Box, Text, Static } from "ink";
import { Markdown } from "./Markdown.js";
import { ToolCallDisplay } from "./ToolCall.js";
import { theme } from "./theme.js";
import type { Message } from "./types.js";

interface MessageListProps {
  /** Committed (finalized) messages. Rendered via Static so they never re-render. */
  messages: Message[];
}

/**
 * Renders the committed conversation history using Ink's <Static> component.
 * Each message is rendered once and then scrolled up, which keeps memory
 * and render cost constant regardless of conversation length.
 *
 * User messages display with the brand diamond prompt and distinct styling.
 * Assistant messages flow as markdown below tool calls.
 */
export function MessageList({ messages }: MessageListProps): React.ReactElement {
  return (
    <Static items={messages}>
      {(message) => (
        <Box key={message.id} flexDirection="column" marginTop={1}>
          {message.role === "user" ? (
            <Box marginLeft={2}>
              <Text color={theme.brand} bold>
                {"\u2771 "}
              </Text>
              <Text color={theme.text}>{message.content}</Text>
            </Box>
          ) : (
            <Box flexDirection="column" marginLeft={2}>
              {message.toolCalls?.map((tc) => (
                <ToolCallDisplay key={tc.id} tool={tc} />
              ))}
              {message.content ? (
                <Markdown content={message.content} />
              ) : null}
            </Box>
          )}
        </Box>
      )}
    </Static>
  );
}
