export default function Pill({ variant = "off", children }) {
  const cls =
    variant === "on"
      ? "status-pill status-pill-on"
      : variant === "off"
        ? "status-pill status-pill-off"
        : "status-pill status-pill-soon";

  return <span className={cls}>{children}</span>;
}
