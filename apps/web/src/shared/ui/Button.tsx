import { forwardRef, type ButtonHTMLAttributes } from "react";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function Button({ className = "", children, ...props }, ref) {
  return (
    <button ref={ref} className={`button ${className}`} {...props}>
      {children}
    </button>
  );
});
