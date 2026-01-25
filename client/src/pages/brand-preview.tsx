import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function BrandPreviewPage() {
  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-semibold">Brand Preview</h1>
        <p className="text-muted-foreground">Claim Shield Health - Visual QA Page</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Logo Assets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-2">
              <Label>Full Logo (logo_full.png)</Label>
              <div className="p-4 bg-muted/50 rounded-lg">
                <img 
                  src="/brand/logo_full.png" 
                  alt="Claim Shield Health Full Logo" 
                  className="h-16 object-contain"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Icon Logo (logo_icon.png)</Label>
              <div className="p-4 bg-muted/50 rounded-lg flex items-center justify-center">
                <img 
                  src="/brand/logo_icon.png" 
                  alt="Claim Shield Health Icon" 
                  className="h-16 w-16 object-contain"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand Colors</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-4">
            <div className="space-y-2">
              <div 
                className="h-20 rounded-lg" 
                style={{ background: "hsl(var(--csh-blue))" }}
              />
              <p className="text-sm font-medium">Primary Blue</p>
              <p className="text-xs text-muted-foreground">210 76% 50%</p>
            </div>
            <div className="space-y-2">
              <div 
                className="h-20 rounded-lg" 
                style={{ background: "hsl(var(--csh-teal))" }}
              />
              <p className="text-sm font-medium">Primary Teal</p>
              <p className="text-xs text-muted-foreground">173 70% 45%</p>
            </div>
            <div className="space-y-2">
              <div 
                className="h-20 rounded-lg" 
                style={{ background: "hsl(var(--csh-slate))" }}
              />
              <p className="text-sm font-medium">Dark Slate</p>
              <p className="text-xs text-muted-foreground">209 20% 23%</p>
            </div>
            <div className="space-y-2">
              <div 
                className="h-20 rounded-lg border" 
                style={{ background: "hsl(var(--csh-bg-soft))" }}
              />
              <p className="text-sm font-medium">Soft BG</p>
              <p className="text-xs text-muted-foreground">195 33% 98%</p>
            </div>
            <div className="space-y-2">
              <div 
                className="h-20 rounded-lg" 
                style={{ background: "linear-gradient(180deg, hsl(var(--csh-blue)) 0%, hsl(var(--csh-teal)) 100%)" }}
              />
              <p className="text-sm font-medium">Gradient</p>
              <p className="text-xs text-muted-foreground">Blue → Teal</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Typography</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h1 className="text-4xl font-semibold">Heading 1 - Inter Semibold</h1>
          </div>
          <div>
            <h2 className="text-3xl font-semibold">Heading 2 - Inter Semibold</h2>
          </div>
          <div>
            <h3 className="text-2xl font-semibold">Heading 3 - Inter Semibold</h3>
          </div>
          <div>
            <p className="text-base">Body text - Inter Regular. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Caption text - Inter Regular, muted color.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <Button data-testid="button-primary">Primary Button</Button>
            <Button variant="secondary" data-testid="button-secondary">Secondary</Button>
            <Button variant="outline" data-testid="button-outline">Outline</Button>
            <Button variant="ghost" data-testid="button-ghost">Ghost</Button>
            <Button variant="destructive" data-testid="button-destructive">Destructive</Button>
            <Button 
              className="text-white border-0"
              style={{ background: "linear-gradient(180deg, hsl(var(--csh-blue)) 0%, hsl(var(--csh-teal)) 100%)" }}
              data-testid="button-accent"
            >
              Accent CTA
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Badges</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">
              Success
            </Badge>
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
              Warning
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Form Inputs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="default-input">Default Input</Label>
              <Input id="default-input" placeholder="Enter text..." data-testid="input-default" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="focused-input">Focus to see ring</Label>
              <Input id="focused-input" placeholder="Click to focus..." data-testid="input-focus" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sample Table</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">John Smith</TableCell>
                <TableCell>
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">
                    Active
                  </Badge>
                </TableCell>
                <TableCell>Jan 15, 2026</TableCell>
                <TableCell className="text-right">$250.00</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Sarah Johnson</TableCell>
                <TableCell>
                  <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
                    Pending
                  </Badge>
                </TableCell>
                <TableCell>Jan 18, 2026</TableCell>
                <TableCell className="text-right">$175.00</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Mike Davis</TableCell>
                <TableCell>
                  <Badge variant="secondary">Inactive</Badge>
                </TableCell>
                <TableCell>Jan 20, 2026</TableCell>
                <TableCell className="text-right">$320.00</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
