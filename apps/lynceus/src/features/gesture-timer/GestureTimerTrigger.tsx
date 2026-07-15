import { forwardRef, type ComponentProps } from "react";
import { Timer } from "lucide-react";
import { Button } from "../../components/ui/button";

export const GestureTimerTrigger = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof Button>
>(function GestureTimerTrigger({ children, ...props }, ref) {
  return (
    <Button ref={ref} type="button" variant="secondary" {...props}>
      <Timer className="size-4" strokeWidth={1.8} />
      {children ?? "Start timer"}
    </Button>
  );
});
