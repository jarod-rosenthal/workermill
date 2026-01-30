import { useRef, useState, useEffect } from "react";
import type { KeyboardEvent, ClipboardEvent } from "react";

interface TotpInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function TotpInput({ value, onChange, disabled = false, autoFocus = true }: TotpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focused, setFocused] = useState(false);

  // Initialize refs array
  useEffect(() => {
    inputRefs.current = inputRefs.current.slice(0, 6);
  }, []);

  // Focus first input on mount if autoFocus is true
  useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus]);

  // Convert value to array of 6 digits
  const digits = value.padEnd(6, "").slice(0, 6).split("");

  const handleChange = (index: number, digit: string) => {
    // Only allow digits
    if (!/^\d*$/.test(digit)) return;

    const newDigits = [...digits];
    newDigits[index] = digit.slice(-1); // Take only the last character

    const newValue = newDigits.join("");
    onChange(newValue);

    // Auto-advance to next input if digit was entered
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    // Handle backspace
    if (e.key === "Backspace") {
      if (!digits[index] && index > 0) {
        // If current is empty, go to previous and clear it
        inputRefs.current[index - 1]?.focus();
        const newDigits = [...digits];
        newDigits[index - 1] = "";
        onChange(newDigits.join(""));
      } else {
        // Clear current
        const newDigits = [...digits];
        newDigits[index] = "";
        onChange(newDigits.join(""));
      }
      e.preventDefault();
    }

    // Handle arrow keys
    if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
      e.preventDefault();
    }
    if (e.key === "ArrowRight" && index < 5) {
      inputRefs.current[index + 1]?.focus();
      e.preventDefault();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pastedData) {
      onChange(pastedData);
      // Focus the appropriate input after paste
      const nextIndex = Math.min(pastedData.length, 5);
      inputRefs.current[nextIndex]?.focus();
    }
  };

  const handleFocus = (index: number) => {
    setFocused(true);
    // Select the content when focused
    inputRefs.current[index]?.select();
  };

  return (
    <div className="flex gap-2 justify-center">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[index] || ""}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={() => handleFocus(index)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          className={`
            w-12 h-14 text-center text-xl font-mono font-bold
            rounded-xl bg-background/50 border
            focus:outline-none focus:ring-2 focus:ring-primary/20
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            ${
              focused && digits[index]
                ? "border-primary/50 bg-primary/5"
                : "border-border hover:border-border/80"
            }
          `}
          aria-label={`Digit ${index + 1} of 6`}
        />
      ))}
    </div>
  );
}
