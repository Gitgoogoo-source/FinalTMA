import type { ComponentProps, ReactNode } from "react";

export function Card({
  children,
  className = "",
  ...props
}: ComponentProps<"section">): ReactNode {
  return (
    <section className={`card ${className}`} {...props}>
      {children}
    </section>
  );
}
