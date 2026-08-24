import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageScaffold } from '@/components/layout/PageScaffold'
import { SectionNav } from '@/components/layout/SectionNav'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  HelpCircle,
  Mail,
  Printer,
  Server,
  Terminal,
} from 'lucide-react'

type HelpSection = 'guide' | 'commands' | 'faq'

const topics = [
  { value: 'guide', label: 'Getting started', mobileLabel: 'Guide', icon: FileText },
  { value: 'commands', label: 'Print commands', mobileLabel: 'Commands', icon: Terminal },
  { value: 'faq', label: 'Troubleshooting', mobileLabel: 'FAQ', icon: HelpCircle },
] as const

const printSteps = [
  ['Connect', 'Use your NUSNET ID to connect to the student or staff computing server.'],
  ['Add document', 'Choose a local PDF from the print workbench.'],
  ['Review', 'Confirm paper size, sides, page range, layout, and copies in preview.'],
  ['Submit', 'Select an available queue and verify the job appears in Print queue.'],
] as const

export default function HelpPage() {
  const [selectedTab, setSelectedTab] = useState<HelpSection>('guide')

  return (
    <PageScaffold
      header={
        <PageHeader
          title="Help centre"
          description="Printing reference for NUS School of Computing"
          icon={<HelpCircle />}
        />
      }
      contentWidth="wide"
    >
      <div className="mb-4 lg:hidden">
        <SegmentedControl
          ariaLabel="Help topic"
          value={selectedTab}
          onValueChange={setSelectedTab}
          mobileLayout="equal"
          mobileHideIcons
          items={topics.map((topic) => ({ ...topic }))}
        />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-4">
        <SectionNav
          label="Documentation"
          value={selectedTab}
          items={topics}
          onValueChange={(value) => setSelectedTab(value as HelpSection)}
          footer={
            <a
              href="mailto:techsvc@comp.nus.edu.sg"
              className="flex h-10 items-center gap-3 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground"
            >
              <Mail className="size-4 shrink-0" />
              Technical Services
            </a>
          }
        />

        <article className="min-w-0 overflow-hidden rounded-md bg-card lg:col-span-3">
          {selectedTab === 'guide' && (
            <>
              <div className="px-5 py-6 sm:px-7">
                <p className="text-xs font-semibold uppercase text-primary">Start here</p>
                <h2 className="mt-2 text-xl font-semibold text-foreground">Print through the SoC computing service</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Print@SoC submits documents to the same Linux print queues available on the School of Computing servers.
                </p>
              </div>

              <div className="grid gap-4 bg-workspace/70 px-5 py-5 sm:grid-cols-2 sm:px-7">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold"><Server className="size-4 text-primary" /> Student server</div>
                  <code className="mt-2 block font-mono text-xs text-muted-foreground">stu.comp.nus.edu.sg</code>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold"><Server className="size-4 text-primary" /> Staff server</div>
                  <code className="mt-2 block font-mono text-xs text-muted-foreground">stf.comp.nus.edu.sg</code>
                </div>
              </div>

              <section className="px-5 py-6 sm:px-7">
                <div className="mb-4 flex items-center gap-2">
                  <Printer className="size-4 text-primary" />
                  <h3 className="text-base font-semibold">Standard workflow</h3>
                </div>
                <ol className="space-y-1">
                  {printSteps.map(([title, description], index) => (
                    <li key={title} className="grid gap-3 py-4 sm:grid-cols-[auto_1fr_2fr] sm:items-start">
                      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">{index + 1}</span>
                      <strong className="text-sm text-foreground">{title}</strong>
                      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="bg-workspace/70 px-5 py-5 sm:px-7">
                <h3 className="text-sm font-semibold text-foreground">Before submission</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {['Connect to the SoC server', 'Use a valid PDF document', 'Confirm available print quota'].map((item) => (
                    <div key={item} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {selectedTab === 'commands' && (
            <>
              <div className="px-5 py-6 sm:px-7">
                <p className="text-xs font-semibold uppercase text-primary">Reference</p>
                <h2 className="mt-2 text-xl font-semibold">Linux print commands</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">The app executes these operations through your active SSH session.</p>
              </div>
              <div className="space-y-2 px-5 pb-6 sm:px-7">
                {[
                  ['Submit a document', 'lpr -P [queue-name] filename.pdf'],
                  ['Inspect a queue', 'lpq -P [queue-name]'],
                  ['Cancel a job', 'lprm -P [queue-name] [job-number]'],
                  ['Create a 2-up layout', 'pdfjam --nup 2x1 input.pdf -o output.pdf'],
                  ['Create a 4-up layout', 'pdfjam --nup 2x2 input.pdf -o output.pdf'],
                ].map(([label, command]) => (
                  <section key={label} className="grid gap-3 py-2 sm:grid-cols-[1fr_2fr] sm:items-center">
                    <h3 className="text-sm font-semibold text-foreground">{label}</h3>
                    <code className="overflow-x-auto rounded-md bg-[#102A40] px-4 py-3 font-mono text-xs text-slate-100">{command}</code>
                  </section>
                ))}
              </div>
            </>
          )}

          {selectedTab === 'faq' && (
            <>
              <div className="px-5 py-6 sm:px-7">
                <p className="text-xs font-semibold uppercase text-primary">Troubleshooting</p>
                <h2 className="mt-2 text-xl font-semibold">Common printing issues</h2>
              </div>
              <div className="px-5 pb-6 sm:px-7">
                <Accordion type="single" collapsible className="w-full space-y-1">
                  <AccordionItem value="rejected" className="border-0">
                    <AccordionTrigger className="text-left hover:no-underline">Why was my print job rejected?</AccordionTrigger>
                    <AccordionContent className="text-sm leading-6 text-muted-foreground">
                      Confirm that the file is printable, the PostScript header is valid when applicable, and your account has sufficient print quota.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="duplex" className="border-0">
                    <AccordionTrigger className="text-left hover:no-underline">How do I print double-sided?</AccordionTrigger>
                    <AccordionContent className="text-sm leading-6 text-muted-foreground">
                      Enable Double-Sided in preview and choose a duplex queue. Queue names ending in <code className="font-mono">-sx</code> are simplex only.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="paper" className="border-0">
                    <AccordionTrigger className="text-left hover:no-underline">What if the printer is out of paper?</AccordionTrigger>
                    <AccordionContent className="text-sm leading-6 text-muted-foreground">
                      Choose another online printer or notify Technical Services when supplies in the printer area are unavailable.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="quota" className="border-0">
                    <AccordionTrigger className="text-left hover:no-underline">Where can I check print quota?</AccordionTrigger>
                    <AccordionContent className="text-sm leading-6 text-muted-foreground">
                      Check your quota through the SoC computing portal or the relevant Unix account command.
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
              <div className="flex flex-col gap-4 bg-workspace/70 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                <div>
                  <div className="text-sm font-semibold text-foreground">Still need help?</div>
                  <div className="mt-1 text-xs text-muted-foreground">Contact SoC Technical Services about account or queue failures.</div>
                </div>
                <div className="flex flex-wrap gap-3 text-sm">
                  <a href="mailto:techsvc@comp.nus.edu.sg" className="inline-flex items-center gap-2 font-medium text-primary hover:underline"><Mail className="size-4" /> techsvc@comp.nus.edu.sg</a>
                  <a href="https://dochub.comp.nus.edu.sg" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">DocHub <ExternalLink className="size-3" /></a>
                </div>
              </div>
            </>
          )}
        </article>
      </div>
    </PageScaffold>
  )
}
