/**
 * Wizard Router — Dynamic wizard loader based on URL param.
 */

import { useParams, useNavigate, Navigate } from 'react-router-dom';
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
    default:
      return <Navigate to="/wizards" replace />;
  }
}
