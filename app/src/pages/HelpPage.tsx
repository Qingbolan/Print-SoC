import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { SimpleCard, SimpleCardHeader, SimpleCardTitle, SimpleCardContent } from '@/components/ui/simple-card'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGroup, StatItem } from '@/components/ui/stat-item'
import { cn } from '@/lib/utils'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Info,
  Server,
  FileText,
  Printer,
  CheckCircle,
  XCircle,
  HelpCircle,
  Mail,
  BookOpen,
  ExternalLink,
} from 'lucide-react'

export default function HelpPage() {
  const [selectedTab, setSelectedTab] = useState<'guide' | 'commands' | 'faq'>('guide')

  return (
    <div className="h-full flex flex-col">
      {/* Header Section */}
      <div className="p-8 space-y-8 border-b border-border/50">
        {/* Header */}
        <div className="flex items-start justify-between">
          <PageHeader
            title="Help & Documentation"
            description="Complete guide for printing from NUS SoC servers"
            icon={<HelpCircle className="w-8 h-8" />}
          />
        </div>

        {/* Stats */}
        <StatGroup>
          <StatItem
            icon={BookOpen}
            value="5"
            label="Topics"
          />
          <div className="w-px h-8 bg-border/50" />
          <StatItem
            icon={Server}
            value="2"
            label="Servers"
          />
          <div className="w-px h-8 bg-border/50" />
          <StatItem
            icon={Printer}
            value="20+"
            label="Printers"
          />
        </StatGroup>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedTab('guide')}
            className={cn(
              'px-6 py-2 rounded-md font-medium transition-colors flex items-center gap-2',
              selectedTab === 'guide'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            <BookOpen className="w-4 h-4" />
            <span>Getting Started</span>
          </button>

          <button
            onClick={() => setSelectedTab('commands')}
            className={cn(
              'px-6 py-2 rounded-md font-medium transition-colors flex items-center gap-2',
              selectedTab === 'commands'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            <Server className="w-4 h-4" />
            <span>Commands</span>
          </button>

          <button
            onClick={() => setSelectedTab('faq')}
            className={cn(
              'px-6 py-2 rounded-md font-medium transition-colors flex items-center gap-2',
              selectedTab === 'faq'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            <HelpCircle className="w-4 h-4" />
            <span>FAQ</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl space-y-6">
          {selectedTab === 'guide' && (
            <>
              {/* Overview */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <Info className="w-5 h-5 text-primary" />
                    Overview
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-4">
                  <p className="text-muted-foreground">
                    Print@SoC is a desktop application that simplifies printing documents
                    from NUS School of Computing's Linux servers. It provides a user-friendly
                    interface for submitting print jobs without using command-line tools.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-accent/50 rounded-lg border border-border/50">
                      <div className="font-semibold mb-2">For Students</div>
                      <div className="text-sm text-muted-foreground">
                        Connect to <Badge variant="secondary">stu.comp.nus.edu.sg</Badge>
                      </div>
                    </div>
                    <div className="p-4 bg-accent/50 rounded-lg border border-border/50">
                      <div className="font-semibold mb-2">For Staff</div>
                      <div className="text-sm text-muted-foreground">
                        Connect to <Badge variant="secondary">stf.comp.nus.edu.sg</Badge>
                      </div>
                    </div>
                  </div>
                </SimpleCardContent>
              </SimpleCard>

              {/* Requirements */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-success" />
                    Before You Print
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
                      <div>
                        <strong>SSH Connection Required:</strong> You must be connected to stu or stf server
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
                      <div>
                        <strong>Supported File Types:</strong> Only PDF, PostScript, and ASCII files
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
                      <div>
                        <strong>Print Quota:</strong> Ensure you have sufficient print quota
                      </div>
                    </li>
                  </ul>
                </SimpleCardContent>
              </SimpleCard>

              {/* How to Print */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <Printer className="w-5 h-5 text-primary" />
                    How to Print
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-6">
                  <div>
                    <h4 className="font-semibold mb-3">1. Connect to Server</h4>
                    <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground ml-4">
                      <li>Go to the Login page</li>
                      <li>Enter your NUSNET ID and password</li>
                      <li>Click "Connect" to establish SSH connection</li>
                    </ul>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-semibold mb-3">2. Select PDF File</h4>
                    <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground ml-4">
                      <li>Go to Home page and click to select your PDF</li>
                      <li>Or drag and drop files into the upload area</li>
                    </ul>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-semibold mb-3">3. Configure Settings</h4>
                    <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground ml-4">
                      <li><strong>Copies:</strong> Number of copies to print</li>
                      <li><strong>Duplex:</strong> Single or double-sided printing</li>
                      <li><strong>Pages per Sheet:</strong> 1, 2, 4, 6, or 9 pages</li>
                    </ul>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-semibold mb-3">4. Select Printer & Print</h4>
                    <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground ml-4">
                      <li>Choose from available printers</li>
                      <li>Queues with "-sx" suffix are single-sided only</li>
                      <li>Click "Print" to submit your job</li>
                    </ul>
                  </div>
                </SimpleCardContent>
              </SimpleCard>
            </>
          )}

          {selectedTab === 'commands' && (
            <>
              {/* Print Commands */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-primary" />
                    Useful Print Commands
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground mb-4">
                    For reference - these commands run automatically when you use the app
                  </p>

                  <div className="space-y-4">
                    <div>
                      <div className="font-semibold mb-2">Submit print job:</div>
                      <code className="block p-3 bg-muted rounded text-sm font-mono">
                        lpr -P [queue-name] filename.pdf
                      </code>
                    </div>

                    <div>
                      <div className="font-semibold mb-2">Check print job status:</div>
                      <code className="block p-3 bg-muted rounded text-sm font-mono">
                        lpq -P [queue-name]
                      </code>
                    </div>

                    <div>
                      <div className="font-semibold mb-2">Cancel a print job:</div>
                      <code className="block p-3 bg-muted rounded text-sm font-mono">
                        lprm -P [queue-name] [job-number]
                      </code>
                    </div>
                  </div>
                </SimpleCardContent>
              </SimpleCard>

              {/* Multi-page Layout */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    Multi-Page Layout (pdfjam)
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Use the "Pages per Sheet" setting to automatically create multi-page layouts:
                  </p>

                  <div className="space-y-3">
                    <div className="p-3 bg-accent/50 rounded-lg border border-border/50">
                      <div className="font-semibold mb-1">2 pages side by side</div>
                      <code className="text-sm text-muted-foreground font-mono">
                        pdfjam --nup 2x1 input.pdf -o output.pdf
                      </code>
                    </div>

                    <div className="p-3 bg-accent/50 rounded-lg border border-border/50">
                      <div className="font-semibold mb-1">4 pages on one sheet</div>
                      <code className="text-sm text-muted-foreground font-mono">
                        pdfjam --nup 2x2 input.pdf -o output.pdf
                      </code>
                    </div>
                  </div>

                  <Alert>
                    <Info className="w-4 h-4" />
                    <AlertTitle>Tip</AlertTitle>
                    <AlertDescription>
                      The app handles this automatically based on your "Pages per Sheet" setting
                    </AlertDescription>
                  </Alert>
                </SimpleCardContent>
              </SimpleCard>
            </>
          )}

          {selectedTab === 'faq' && (
            <>
              {/* FAQ Accordion */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-primary" />
                    Frequently Asked Questions
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent>
                  <Accordion type="single" collapsible className="w-full space-y-2">
                    <AccordionItem value="rejected" className="border rounded-lg px-4">
                      <AccordionTrigger className="hover:no-underline">
                        Why was my print job rejected?
                      </AccordionTrigger>
                      <AccordionContent className="pt-2">
                        <Alert variant="destructive">
                          <AlertTitle>Print jobs will be rejected if:</AlertTitle>
                          <AlertDescription>
                            <ul className="list-disc list-inside space-y-1 mt-2">
                              <li>The file is detected as unprintable</li>
                              <li>PostScript files don't have the proper magic code (%!)</li>
                              <li>You have insufficient print quota</li>
                            </ul>
                          </AlertDescription>
                        </Alert>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="duplex" className="border rounded-lg px-4">
                      <AccordionTrigger className="hover:no-underline">
                        How do I print double-sided?
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 text-muted-foreground">
                        Enable the "Double-Sided" toggle in print settings. Make sure you're using a printer
                        queue without the "-sx" suffix, as those are single-sided only.
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="paper" className="border rounded-lg px-4">
                      <AccordionTrigger className="hover:no-underline">
                        What if the printer is out of paper?
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 text-muted-foreground">
                        <ul className="list-disc list-inside space-y-1">
                          <li>Staff can load paper when printers run out</li>
                          <li>Paper reams are stored in the printer room</li>
                          <li>If supplies are empty, notify the General Office</li>
                        </ul>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="quota" className="border rounded-lg px-4">
                      <AccordionTrigger className="hover:no-underline">
                        How do I check my print quota?
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 text-muted-foreground">
                        You can check your print quota through the SoC computing portal or by running
                        the appropriate command on the Unix server.
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </SimpleCardContent>
              </SimpleCard>

              {/* Contact */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <Mail className="w-5 h-5 text-primary" />
                    Need Help?
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-4">
                  <p className="text-muted-foreground">
                    If you have questions about rejected print jobs, contact:
                  </p>
                  <a
                    href="mailto:techsvc@comp.nus.edu.sg"
                    className="inline-flex items-center gap-2 text-primary hover:underline"
                  >
                    <Mail className="w-4 h-4" />
                    techsvc@comp.nus.edu.sg
                  </a>

                  <div className="pt-4 border-t border-border/50">
                    <h4 className="font-semibold mb-3">Additional Resources</h4>
                    <ul className="space-y-2 text-sm">
                      <li>
                        <a
                          href="https://dochub.comp.nus.edu.sg/cf/guides/unix/soc_unix_env"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          SoC Unix Environment Guide
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://dochub.comp.nus.edu.sg"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          Print Quota Policy
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </li>
                    </ul>
                  </div>
                </SimpleCardContent>
              </SimpleCard>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
