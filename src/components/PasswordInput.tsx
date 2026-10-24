"use client";

import { useId, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordInputProps = Omit<ComponentProps<"input">, "type"> & {
  containerClassName?: string;
  visibilityLabel?: string;
};

export default function PasswordInput({
  id,
  className = "w-full rounded-xl border p-3",
  containerClassName = "",
  visibilityLabel = "รหัสผ่าน",
  disabled,
  ...props
}: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const label = `${visible ? "ซ่อน" : "แสดง"}${visibilityLabel}`;
  const Icon = visible ? EyeOff : Eye;

  return (
    <span className={`relative block w-full ${containerClassName}`}>
      <input {...props} id={inputId} type={visible ? "text" : "password"} disabled={disabled} className={`${className} pr-12`} />
      <button
        type="button"
        onClick={() => setVisible(previous => !previous)}
        disabled={disabled}
        aria-label={label}
        aria-controls={inputId}
        aria-pressed={visible}
        title={label}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-blu-steel hover:text-blu-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blu-slate disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon aria-hidden="true" className="h-5 w-5" />
      </button>
    </span>
  );
}
