import { useState } from "react";
import { useGenerateEmailDraft, type EmailDraft } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, Mail, CheckCheck } from "lucide-react";

interface EmailDraftModalProps {
  invoiceId: number;
  open: boolean;
  onClose: () => void;
}

export function EmailDraftModal({ invoiceId, open, onClose }: EmailDraftModalProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [copied, setCopied] = useState(false);
  const generateDraft = useGenerateEmailDraft();

  const handleGenerate = async () => {
    try {
      const data = await generateDraft.mutateAsync({ id: invoiceId });
      setDraft(data);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to generate email draft." });
    }
  };

  const handleCopy = async () => {
    if (!draft) return;
    const text = `To: ${draft.to ?? draft.lawFirmContactName ?? draft.lawFirmName ?? ""}\nSubject: ${draft.subject}\n\n${draft.body}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "Copied", description: "Email draft copied to clipboard." });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setDraft(null);
    setCopied(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Email Draft to Law Firm
          </DialogTitle>
        </DialogHeader>

        {!draft ? (
          <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Mail className="h-8 w-8 text-primary" strokeWidth={1.5} />
            </div>
            <h3 className="font-semibold text-foreground mb-2">Generate Dispute Email</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              Generate a professional email draft to the law firm listing the rejected issues. The AI will write in a firm, courteous tone without exposing internal metrics or rule codes.
            </p>
            <Button onClick={handleGenerate} disabled={generateDraft.isPending}>
              {generateDraft.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
              ) : (
                <><Mail className="h-4 w-4 mr-2" /> Generate Draft</>
              )}
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="space-y-3 py-2">
              {(draft.to || draft.lawFirmContactName) && (
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="text-muted-foreground font-medium w-16 flex-shrink-0">To:</span>
                  <span className="font-medium">
                    {draft.lawFirmContactName && <span>{draft.lawFirmContactName} </span>}
                    {draft.to && <span className="text-muted-foreground">&lt;{draft.to}&gt;</span>}
                    {!draft.to && !draft.lawFirmContactName && <span className="text-muted-foreground italic">No contact on file</span>}
                  </span>
                </div>
              )}
              <div className="flex items-baseline gap-2 text-sm">
                <span className="text-muted-foreground font-medium w-16 flex-shrink-0">Subject:</span>
                <span className="font-medium">{draft.subject}</span>
              </div>
              <div className="border-t border-border pt-3">
                <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                  {draft.body}
                </pre>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex-shrink-0 border-t border-border pt-4">
          {draft && (
            <>
              <Button
                variant="outline"
                onClick={handleGenerate}
                disabled={generateDraft.isPending}
                size="sm"
              >
                {generateDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Regenerate"}
              </Button>
              <Button onClick={handleCopy} size="sm" className="gap-2">
                {copied ? <CheckCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied!" : "Copy to Clipboard"}
              </Button>
            </>
          )}
          <Button variant="outline" onClick={handleClose} size="sm">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
