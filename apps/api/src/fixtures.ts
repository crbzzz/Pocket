import type { Project, Report, Model } from './domain.js';
export const demoUser = '00000000-0000-4000-8000-000000000001';
export const demoProject = '00000000-0000-4000-8000-000000000010';
export const demoToken = 'pocket-local-demo';
export const models: Model[] = [
  {
    id: 'auto',
    name: 'Auto',
    description: 'The right model for every step',
    provider: 'demo',
    maxCostCents: 300,
  },
  {
    id: 'fast',
    name: 'Fast',
    description: 'Small fixes, quick iterations',
    provider: 'demo',
    maxCostCents: 100,
  },
  {
    id: 'powerful',
    name: 'Powerful',
    description: 'Complex changes, deeper reasoning',
    provider: 'demo',
    maxCostCents: 800,
  },
];
export const projects: Project[] = [
  {
    id: demoProject,
    name: 'Butterfly',
    owner: 'edouard',
    description: 'A little more room for your ideas.',
    language: 'TypeScript',
    color: '#79936d',
    branch: 'main',
    branches: ['main', 'develop'],
    memory: {
      stack: ['Next.js', 'TypeScript', 'Supabase'],
      objective: 'Make the dashboard feel at home on mobile.',
      decisions: [
        'Keep the existing authentication architecture.',
        'Do not modify the backend.',
        'Keep every dashboard view responsive.',
      ],
      recentWork: ['Dashboard cards redesigned.', 'Navigation simplified.'],
    },
    updatedAt: new Date().toISOString(),
  },
  {
    id: '00000000-0000-4000-8000-000000000011',
    name: 'Pocket',
    owner: 'edouard',
    description: 'Your coding agent, in your pocket.',
    language: 'Swift',
    color: '#db9264',
    branch: 'main',
    branches: ['main'],
    memory: {
      stack: ['SwiftUI', 'TypeScript', 'PostgreSQL'],
      objective: 'Ship from anywhere.',
      decisions: ['All execution happens in cloud sandboxes.'],
      recentWork: [],
    },
    updatedAt: new Date().toISOString(),
  },
  {
    id: '00000000-0000-4000-8000-000000000012',
    name: 'Atlas',
    owner: 'edouard',
    description: 'A quieter place to find your next adventure.',
    language: 'TypeScript',
    color: '#7b96b7',
    branch: 'main',
    branches: ['main', 'next'],
    memory: {
      stack: ['React', 'TypeScript'],
      objective: 'Improve the discovery experience.',
      decisions: [],
      recentWork: [],
    },
    updatedAt: new Date().toISOString(),
  },
];
export const demoReport: Report = {
  summary:
    'The dashboard now adapts to smaller screens. The sidebar becomes a compact drawer on mobile, and cards flow into a single column. Backend code is unchanged.',
  files: [
    {
      path: 'src/components/sidebar.tsx',
      additions: 42,
      deletions: 18,
      patch:
        '@@ -12,6 +12,9 @@ export function Sidebar() {\n  const pathname = usePathname();\n- return <aside className="w-64 border-r">\n+ const [isOpen, setIsOpen] = useState(false);\n+ return <aside className={cn(\n+   "fixed inset-y-0 z-40 w-64 border-r md:relative",\n+   isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"\n+ )}>\n    <Navigation pathname={pathname} />\n  </aside>;',
    },
    {
      path: 'src/app/dashboard/page.tsx',
      additions: 24,
      deletions: 9,
      patch:
        '@@ -18,5 +18,5 @@ export default function Dashboard() {\n  return (\n-   <main className="flex gap-8 p-8">\n+   <main className="flex flex-col gap-4 p-4 md:gap-8 md:p-8">\n      <DashboardHeader />\n-     <div className="grid grid-cols-3 gap-6">\n+     <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">\n        <DashboardCards />',
    },
    {
      path: 'src/components/mobile-nav.tsx',
      additions: 31,
      deletions: 0,
      patch:
        '@@ -0,0 +1,7 @@\n+export function MobileNav({ onOpen }: { onOpen: () => void }) {\n+  return (\n+    <button onClick={onOpen} aria-label="Open navigation"\n+      className="rounded-lg p-2 md:hidden">\n+      <Menu size={20} />\n+    </button>\n+  );\n+}',
    },
    {
      path: 'src/components/sidebar.test.tsx',
      additions: 19,
      deletions: 3,
      patch:
        '@@ -8,3 +8,5 @@\n- it("renders navigation", () => {\n+ it("opens navigation on mobile", async () => {\n+   await user.click(screen.getByLabelText("Open navigation"));\n+   expect(screen.getByRole("navigation")).toBeVisible();\n  });',
    },
  ],
  checks: [
    { name: 'Tests', status: 'passed', detail: '24 tests passed · simulated demo result' },
    { name: 'Build', status: 'passed', detail: 'Build successful · simulated demo result' },
  ],
  snapshotRef: 'demo:snapshot:mobile-dashboard',
  baseRef: 'demo:base:dashboard',
  costCents: 0,
};
