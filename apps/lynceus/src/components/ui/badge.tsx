import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-[560] leading-none tracking-[-0.005em] transition-[color,background-color,border-color,box-shadow] [&>svg]:size-3 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25",
  {
    variants: {
      variant: {
        default:
          "border-border bg-secondary text-secondary-foreground [a&]:hover:border-border-strong [a&]:hover:bg-accent",
        secondary:
          "border-border bg-secondary text-secondary-foreground [a&]:hover:border-border-strong [a&]:hover:bg-accent",
        destructive:
          "border-destructive/45 bg-destructive text-primary-foreground [a&]:hover:bg-destructive/88 focus-visible:ring-destructive/25",
        outline:
          "border-border-strong bg-surface-raised/55 text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
