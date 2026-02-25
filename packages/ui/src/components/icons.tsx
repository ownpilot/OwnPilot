// Re-export icons from lucide-react (103 matching names)
export {
  Activity,
  AlertCircle,
  AlertTriangle,
  Archive,
  BarChart,
  BookOpen,
  Bookmark,
  Bot,
  Brain,
  Building,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Code,
  Container,
  Copy,
  Cpu,
  Database,
  DollarSign,
  Download,
  Edit,
  Edit2,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileText,
  Filter,
  Focus,
  Folder,
  FolderOpen,
  Gauge,
  GitBranch,
  Github,
  Globe,
  HardDrive,
  Hash,
  Heart,
  History,
  Home,
  Image,
  Inbox,
  Info,
  Key,
  LayoutDashboard,
  Lightbulb,
  Link,
  ListChecks,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  Mic,
  MonitorCheck,
  PanelRight,
  Pause,
  Phone,
  Pin,
  Play,
  Plus,
  Power,
  Puzzle,
  Receipt,
  RefreshCw,
  Repeat,
  RotateCcw,
  Save,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  StopCircle,
  Table,
  Target,
  Terminal,
  Trash,
  Trash2,
  TrendingUp,
  Twitter,
  Unlink,
  Unlock,
  Upload,
  User,
  UserCircle,
  Users,
  Volume2,
  Wrench,
  X,
  XCircle,
  Maximize2,
  Minimize2,
  Zap,
} from 'lucide-react';

// Custom icons not available in lucide-react
import type { SVGProps } from 'react';
type IconProps = SVGProps<SVGSVGElement>;

export function Channels(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

export function Telegram(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21.2 4.4 2.4 10.8c-.6.2-.6 1.1 0 1.3l4.6 1.7 1.8 5.6c.1.4.6.6.9.3l2.6-2.1 4.5 3.3c.4.3 1 .1 1.1-.4L21.8 5.3c.2-.6-.3-1.1-.6-.9Z" />
      <path d="m8.8 13.8 7.5-5.8" />
    </svg>
  );
}

export function Discord(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M8.5 17h0" />
      <path d="M15.5 17h0" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}
