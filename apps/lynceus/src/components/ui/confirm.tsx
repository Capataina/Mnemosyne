import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  alert?: boolean;
}

export type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);

  if (!confirm) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }

  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((result: boolean) => void) | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const settle = useCallback((result: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolve?.(result);
  }, []);

  const confirm = useCallback<Confirm>((nextOptions) => {
    resolverRef.current?.(false);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(nextOptions);
    });
  }, []);

  useEffect(
    () => () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    },
    [],
  );

  const isAlert = options?.alert === true;
  const confirmLabel =
    options?.confirmLabel ?? (isAlert ? "OK" : "Confirm");

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={options !== null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        {options && (
          <DialogContent
            showCloseButton={false}
            className="sm:max-w-[420px]"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              confirmButtonRef.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>{options.title}</DialogTitle>
              <DialogDescription
                className={options.description ? undefined : "sr-only"}
              >
                {options.description ??
                  (isAlert
                    ? "Acknowledge this message to continue."
                    : "Choose whether to continue.")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {!isAlert && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => settle(false)}
                >
                  {options.cancelLabel ?? "Cancel"}
                </Button>
              )}
              <Button
                ref={confirmButtonRef}
                type="button"
                variant={options.destructive ? "outline" : "default"}
                className={
                  options.destructive
                    ? "border-destructive/55 bg-destructive/10 text-destructive hover:border-destructive/65 hover:bg-destructive/[0.14] hover:text-destructive focus-visible:border-destructive/65 focus-visible:ring-destructive/25"
                    : undefined
                }
                onClick={() => settle(true)}
              >
                {confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}
