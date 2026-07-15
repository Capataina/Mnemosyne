import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-[13px] font-[560] tracking-[-0.01em] outline-none transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:border-ring aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25",
  {
    variants: {
      variant: {
        default:
          "border border-foreground/70 bg-foreground text-background shadow-[inset_0_1px_0_oklch(0.98_0.005_245/0.12)] hover:bg-foreground/88 hover:border-foreground",
        destructive:
          "border border-destructive/60 bg-destructive text-primary-foreground hover:bg-destructive/88 focus-visible:ring-destructive/25",
        outline:
          "border border-border-strong bg-surface-raised/72 text-foreground shadow-[inset_0_1px_0_oklch(0.98_0.005_245/0.04)] hover:border-border-strong hover:bg-accent",
        secondary:
          "border border-border bg-secondary text-secondary-foreground hover:border-border-strong hover:bg-accent",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        link: "rounded-none text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 has-[>svg]:px-3.5",
        sm: "h-8 gap-1.5 rounded-lg px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-11 px-5 has-[>svg]:px-4",
        icon: "size-10",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
