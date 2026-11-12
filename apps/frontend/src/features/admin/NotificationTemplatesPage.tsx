import { useState } from 'react'
import { FileText, Plus } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader, ListEmpty, DetailSheet, TableCard, PageToolbar } from '@/components/layout'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { formatDateTime } from '@/lib/format'
import {
  useNotificationTemplates,
  useDeleteNotificationTemplate,
  type NotificationTemplate,
  type NotificationTemplateChannel,
} from './notificationsApi'
import NotificationTemplateDialog from './NotificationTemplateDialog'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

type ChannelTab = 'All' | NotificationTemplateChannel

const CHANNEL_TABS: ChannelTab[] = ['All', 'SMS', 'Email', 'Push']

function channelVariant(channel: NotificationTemplateChannel) {
  switch (channel) {
    case 'SMS':
      return 'info' as const
    case 'Email':
      return 'ok' as const
    case 'Push':
      return 'overdue' as const
  }
}

export default function NotificationTemplatesPage() {
  const [channelTab, setChannelTab] = useState<ChannelTab>('All')
  const [search, setSearch] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<NotificationTemplate | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const filters = channelTab === 'All' ? {} : { channel: channelTab as NotificationTemplateChannel }

  const { data, isLoading, isError } = useNotificationTemplates(filters)
  const deleteMutation = useDeleteNotificationTemplate()

  const allTemplates = data?.data ?? []

  const rows = search
    ? allTemplates.filter((t) => t.code.toLowerCase().includes(search.toLowerCase()))
    : allTemplates

  function handleRowClick(template: NotificationTemplate) {
    setSelectedTemplate(template)
  }

  function handleNewClick() {
    setEditingTemplate(null)
    setDialogOpen(true)
  }

  function handleEditClick() {
    setEditingTemplate(selectedTemplate)
    setDialogOpen(true)
  }

  function handleDeleteClick() {
    if (!selectedTemplate) return
    setConfirmDeleteOpen(true)
  }

  function confirmDelete() {
    if (!selectedTemplate) return
    deleteMutation.mutate(
      { id: selectedTemplate.id },
      {
        onSuccess: () => {
          toast('Template deleted', { description: selectedTemplate.code })
          setConfirmDeleteOpen(false)
          setSelectedTemplate(null)
        },
        onError: (err) => {
          toast.error('Failed to delete template', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  function bodyPreview(body: string): string {
    return body.length > 80 ? body.slice(0, 80) + '…' : body
  }

  return (
    <div className="h-full flex flex-col">
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Notification Templates"
          description={
            isLoading
              ? 'Loading…'
              : `${allTemplates.length} template${allTemplates.length !== 1 ? 's' : ''}`
          }
          actions={
            <Button size="sm" onClick={handleNewClick}>
              <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              New Template
            </Button>
          }
        />
      </div>

      {/* Filter tabs + search */}
      <PageToolbar>
        <Tabs value={channelTab} onValueChange={(v) => setChannelTab(v as ChannelTab)}>
          <TabsList className="h-8">
            {CHANNEL_TABS.map((ch) => (
              <TabsTrigger key={ch} value={ch} className="text-xs px-3 h-7">
                {ch}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          placeholder="Search by template code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm max-w-sm xl:max-w-md ml-auto"
        />
      </PageToolbar>

      {/* Table */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          )}

          {isError && !isLoading && (
            <div className="py-12 text-center">
              <p className="text-sm text-destructive">Failed to load templates.</p>
            </div>
          )}

          {!isLoading && !isError && rows.length === 0 && (
            <ListEmpty icon={FileText} message="No templates found." />
          )}

          {!isLoading && !isError && rows.length > 0 && (
            <TableCard>
              <Table className="w-full text-sm">
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-left px-6 font-medium">Code</TableHead>
                    <TableHead className="text-left px-4 font-medium">Channel</TableHead>
                    <TableHead className="text-left px-4 font-medium">Lang</TableHead>
                    <TableHead className="text-left px-4 font-medium">Status</TableHead>
                    <TableHead className="text-left px-4 font-medium">Subject</TableHead>
                    <TableHead className="text-left px-4 font-medium">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => (
                    <TableRow
                      interactive
                      key={t.id}
                      onClick={() => handleRowClick(t)}
                      className="border-b border-border hover:bg-accent/50 transition-colors cursor-pointer"
                    >
                      <TableCell className="px-6">
                        <span className="font-mono tabular-nums text-xs">{t.code}</span>
                      </TableCell>
                      <TableCell className="px-4">
                        <Badge variant={channelVariant(t.channel)} className="text-xs">
                          {t.channel}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground text-xs font-mono tabular-nums">
                        {t.language}
                      </TableCell>
                      <TableCell className="px-4">
                        <Badge variant={t.isActive ? 'ok' : 'secondary'} className="text-xs">
                          {t.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground text-xs max-w-[12.5rem] truncate">
                        {t.subject ? bodyPreview(t.subject) : '—'}
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground text-xs font-mono tabular-nums">
                        {formatDateTime(t.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="px-6 py-2 xl:px-8 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {rows.length} template{rows.length !== 1 ? 's' : ''}
          {channelTab !== 'All' ? ` · ${channelTab}` : ''}
        </p>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selectedTemplate} onOpenChange={(open) => !open && setSelectedTemplate(null)}>
        <DetailSheet>
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle>Template Detail</SheetTitle>
          </SheetHeader>

          {selectedTemplate && (
            <div className="flex-1 overflow-auto">
              <div className="px-6 py-4 space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Code</p>
                  <p className="text-sm font-mono tabular-nums mt-1">{selectedTemplate.code}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Channel</p>
                    <Badge
                      variant={channelVariant(selectedTemplate.channel)}
                      className="text-xs mt-1"
                    >
                      {selectedTemplate.channel}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      Language
                    </p>
                    <p className="text-sm font-mono tabular-nums mt-1">
                      {selectedTemplate.language}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Status</p>
                  <Badge
                    variant={selectedTemplate.isActive ? 'ok' : 'secondary'}
                    className="text-xs mt-1"
                  >
                    {selectedTemplate.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Subject</p>
                  <p className="text-sm mt-1">{selectedTemplate.subject ?? '—'}</p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Body</p>
                  <pre className="text-sm mt-1 whitespace-pre-wrap font-sans bg-muted/40 rounded-md p-3 border border-border">
                    {selectedTemplate.body}
                  </pre>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Created</p>
                    <p className="text-xs font-mono tabular-nums mt-1">
                      {formatDateTime(selectedTemplate.createdAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Updated</p>
                    <p className="text-xs font-mono tabular-nums mt-1">
                      {formatDateTime(selectedTemplate.updatedAt)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions footer */}
              <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 flex items-center gap-2">
                <Button size="sm" onClick={handleEditClick}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteClick}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </div>
          )}
        </DetailSheet>
      </Sheet>

      {/* Create/Edit Dialog */}
      <NotificationTemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={editingTemplate}
      />

      {/* Confirm delete */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete template <span className="font-mono">{selectedTemplate?.code ?? ''}</span>?
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
