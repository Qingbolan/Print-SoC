import { ReactNode } from "react"
import { cn } from "@/lib/utils"

export default function AnimatedGradientText({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "group relative mx-auto flex max-w-fit flex-row items-center justify-center rounded-lg bg-white/40 px-4 py-1.5 text-sm font-medium shadow-[inset_0_-8px_10px_color-mix(in_srgb,var(--brand-blue)_12%,transparent)] backdrop-blur-sm transition-shadow duration-500 ease-out [--bg-size:300%] hover:shadow-[inset_0_-5px_10px_color-mix(in_srgb,var(--brand-orange)_18%,transparent)] dark:bg-black/40",
        className
      )}
    >
      <div
        className={`absolute inset-0 block h-full w-full animate-gradient bg-gradient-to-r from-[var(--brand-orange)]/55 via-[var(--brand-blue)]/50 to-[var(--brand-orange)]/55 bg-[length:var(--bg-size)_100%] p-[1px] ![mask-composite:subtract] [border-radius:inherit] [mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)]`}
      />
      {children}
    </div>
  )
}
