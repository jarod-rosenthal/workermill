import { useState } from "react";
import { API_BASE } from "../types";

interface UseTalkToWorkerParams {
  setActionSuccess: (msg: string | null) => void;
  setActionError: (msg: string | null) => void;
}

export function useTalkToWorker({ setActionSuccess, setActionError }: UseTalkToWorkerParams) {
  const [isTalkOpen, setIsTalkOpen] = useState(false);
  const [talkMessage, setTalkMessage] = useState("");
  const [talkLoading, setTalkLoading] = useState(false);
  const [talkTargetTaskId, setTalkTargetTaskId] = useState<string | null>(null);
  const [talkTargetTaskTitle, setTalkTargetTaskTitle] = useState<string>("");

  const handleTalkToWorker = async (immediate: boolean = true) => {
    if (!talkMessage.trim() || !talkTargetTaskId) return;

    setTalkLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const taskId = talkTargetTaskId;
      const message = talkMessage.trim();

      const sendCommand = (type: string, content?: string) =>
        fetch(`${API_BASE}/api/coordination/commands`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ taskId, type, content }),
        });

      if (immediate) {
        await sendCommand("pause", "Pausing for user message");
        await new Promise((resolve) => setTimeout(resolve, 500));
        await sendCommand("resume", message);
        setActionSuccess(`Message sent to worker (immediate delivery)`);
      } else {
        await sendCommand("message", message);
        setActionSuccess(`Message queued for worker (will be delivered at next story)`);
      }

      setTimeout(() => setActionSuccess(null), 3000);

      setTalkMessage("");
      setTalkTargetTaskId(null);
      setTalkTargetTaskTitle("");
      setIsTalkOpen(false);
    } catch (_err) {
      setActionError("Failed to send message to worker");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setTalkLoading(false);
    }
  };

  const openTalkModal = (taskId: string, taskTitle: string) => {
    setTalkTargetTaskId(taskId);
    setTalkTargetTaskTitle(taskTitle);
    setIsTalkOpen(true);
  };

  const closeTalkModal = () => {
    setIsTalkOpen(false);
    setTalkMessage("");
    setTalkTargetTaskId(null);
    setTalkTargetTaskTitle("");
  };

  return {
    isTalkOpen,
    talkMessage,
    setTalkMessage,
    talkLoading,
    talkTargetTaskId,
    talkTargetTaskTitle,
    handleTalkToWorker,
    openTalkModal,
    closeTalkModal,
  };
}
