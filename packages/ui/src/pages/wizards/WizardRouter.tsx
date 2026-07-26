/**
 * Wizard Router — Dynamic wizard loader based on URL param.
 */

import { useParams, useNavigate, Navigate } from 'react-router';
import { useToast } from '../../components/ToastProvider';
import { AIProviderWizard } from './AIProviderWizard';
import { TelegramWizard } from './TelegramWizard';
import { McpServerWizard } from './McpServerWizard';
import { AgentCreatorWizard } from './AgentCreatorWizard';
import { CustomToolWizard } from './CustomToolWizard';
import { WorkflowWizard } from './WorkflowWizard';
import { GoalWizard } from './GoalWizard';
import { TriggerWizard } from './TriggerWizard';
import { ConnectedAppWizard } from './ConnectedAppWizard';
import { ClawWizard } from './ClawWizard';
import { SkillInstallWizard } from './SkillInstallWizard';
import { HabitWizard } from './HabitWizard';
import { EdgeDeviceWizard } from './EdgeDeviceWizard';
import { BackupWizard } from './BackupWizard';
import { ChannelWizard } from './ChannelWizard';
import { PluginInstallWizard } from './PluginInstallWizard';

export function WizardRouter() {
  const { wizardId } = useParams<{ wizardId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const handleComplete = () => {
    if (wizardId) {
      localStorage.setItem(`ownpilot-wizard-${wizardId}`, 'true');
    }
    toast.success('Setup completed!');
    navigate('/wizards');
  };

  const handleCancel = () => {
    navigate('/wizards');
  };

  switch (wizardId) {
    case 'ai-provider':
      return <AIProviderWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'telegram':
      return <TelegramWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'mcp-server':
      return <McpServerWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'agent':
      return <AgentCreatorWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'custom-tool':
      return <CustomToolWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'workflow':
      return <WorkflowWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'goal':
      return <GoalWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'trigger':
      return <TriggerWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'connected-app':
      return <ConnectedAppWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'claw':
      return <ClawWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'skill':
      return <SkillInstallWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'habit':
      return <HabitWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'edge-device':
      return <EdgeDeviceWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'backup':
      return <BackupWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'channel':
      return <ChannelWizard onComplete={handleComplete} onCancel={handleCancel} />;
    case 'plugin':
      return <PluginInstallWizard onComplete={handleComplete} onCancel={handleCancel} />;
    default:
      return <Navigate to="/wizards" replace />;
  }
}
