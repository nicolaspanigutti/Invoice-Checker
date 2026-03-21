import { LucideIcon } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

export function PlaceholderPage({ title, description, icon: Icon }: PlaceholderPageProps) {
  return (
    <div className="flex flex-col min-h-[50vh] items-center justify-center text-center animate-in fade-in zoom-in-95 duration-700 ease-out">
      <div className="h-24 w-24 bg-primary/5 text-primary rounded-3xl flex items-center justify-center mb-8 shadow-sm border border-primary/10">
        <Icon className="h-12 w-12" strokeWidth={1.5} />
      </div>
      <h2 className="text-3xl font-display font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mt-4 text-lg text-muted-foreground max-w-lg leading-relaxed">
        {description}
      </p>
    </div>
  );
}
