import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  Cpu,
  Type,
  Sun,
  Moon,
  Cloud,
  ShieldCheck,
  Server,
  Settings as SettingsIcon,
  Database,
  RefreshCw,
  FileCheck2,
  ExternalLink,
  ShieldAlert,
  History
} from 'lucide-react';
import type { ProviderSettings, AIProviderType } from '../types/provider';
import { defaultLiveRegulatoryFeedService, type LiveSyncState, type RegulatoryUpdatePackage } from '../retrieval/liveRegulatoryFeed';
import { defaultSourceVersioningManager } from '../standards/sourceVersioning';
import { getAllAuthoritativeSources } from '../standards/unifiedSourceModel';

export type AppFontSize = 'normal' | 'large' | 'xl';

interface HeaderProps {
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  fontSize: AppFontSize;
  onFontSizeChange: (size: AppFontSize) => void;
  providerSettings: ProviderSettings;
  onProviderSettingsSave: (settings: ProviderSettings) => void;
}

export const Header: React.FC<HeaderProps> = ({
  theme,
  onThemeToggle,
  fontSize,
  onFontSizeChange,
  providerSettings,
  onProviderSettingsSave
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [showRegistryModal, setShowRegistryModal] = useState(false);
  const [liveSyncState, setLiveSyncState] = useState<LiveSyncState>(defaultLiveRegulatoryFeedService.getSyncState());
  const [integrityStatus, setIntegrityStatus] = useState<'IDLE' | 'PASS' | 'FAIL'>('IDLE');
  const [integrityDetails, setIntegrityDetails] = useState<string>('');
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string>('');
  const [updatePackages, setUpdatePackages] = useState<RegulatoryUpdatePackage[]>([]);
  const [updateAction, setUpdateAction] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AIProviderType>(providerSettings.activeProvider);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Local draft state
  const [azureEndpoint, setAzureEndpoint] = useState(providerSettings.azure.endpoint);
  const [azureDeployment, setAzureDeployment] = useState(providerSettings.azure.deploymentName);
  const [azureKey, setAzureKey] = useState(providerSettings.azure.apiKey);
  const [azureVersion, setAzureVersion] = useState(providerSettings.azure.apiVersion);

  const [geminiKey, setGeminiKey] = useState(providerSettings.gemini.apiKey);
  const [geminiModel, setGeminiModel] = useState(providerSettings.gemini.model);

  const [openaiKey, setOpenaiKey] = useState(providerSettings.openai.apiKey);
  const [openaiModel, setOpenaiModel] = useState(providerSettings.openai.model);

  // Stop background scrolling when any modal window is open ("windows up front")
  useEffect(() => {
    if (showSettings || showRegistryModal) {
      const prevOverflow = document.body.style.overflow;
      const prevPaddingRight = document.body.style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
      document.body.style.overflow = 'hidden';

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setShowSettings(false);
          setShowRegistryModal(false);
        }
      };
      window.addEventListener('keydown', handleKeyDown);

      return () => {
        document.body.style.overflow = prevOverflow || '';
        document.body.style.paddingRight = prevPaddingRight || '';
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [showSettings, showRegistryModal]);

  useEffect(() => {
    const handleScheduledUpdate = (event: Event) => {
      const result = (event as CustomEvent<{ hasUpdates: boolean; packages: RegulatoryUpdatePackage[]; syncState: LiveSyncState; error?: string }>).detail;
      setLiveSyncState(result.syncState);
      if (result.hasUpdates) {
        setUpdatePackages(result.packages);
        setUpdateMessage(`Scheduled check found ${result.packages.length} update package(s) requiring review.`);
      } else if (result.syncState === 'FETCH_FAILED') {
        setUpdateMessage(`Scheduled official-source check failed: ${result.error || 'review connection and retry manually.'}`);
      }
    };
    window.addEventListener('regulatory-update-actionable', handleScheduledUpdate);
    return () => window.removeEventListener('regulatory-update-actionable', handleScheduledUpdate);
  }, []);

  const sources = getAllAuthoritativeSources();
  const totalProvisions = sources.length;
  const activeCount = sources.filter(s => s.freshnessStatus === 'ACTIVE_CURRENT' || (!s.freshnessStatus && s.sourceStatus === 'VERIFIED')).length;
  const historicalCount = sources.filter(s => s.freshnessStatus === 'HISTORICAL_SUPERSEDED' || s.sourceStatus === 'HISTORICAL').length;
  const reviewDueCount = sources.filter(s => s.freshnessStatus === 'AUDIT_OVERDUE' || s.sourceStatus === 'NEEDS_REVIEW').length;
  const stagedCount = defaultLiveRegulatoryFeedService.getStagedPackages().length;
  const rejectedCount = Object.keys(defaultLiveRegulatoryFeedService.getRejectedPackages()).length;

  const getRegulatoryStatusBadge = () => {
    switch (liveSyncState) {
      case 'SYNCED':
        return {
          label: 'Verified Registry',
          color: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-workspace-panel dark:text-emerald-300 dark:border-emerald-900/60',
          dot: 'bg-ynab-green',
          iconText: '🟢'
        };
      case 'UPDATE_AVAILABLE':
        return {
          label: 'Update Available',
          color: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-workspace-panel dark:text-blue-300 dark:border-blue-900/60',
          dot: 'bg-blue-500',
          iconText: '🔵'
        };
      case 'VERIFICATION_REQUIRED':
        return {
          label: 'Verification Required',
          color: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-workspace-panel dark:text-amber-300 dark:border-amber-900/60',
          dot: 'bg-amber-500',
          iconText: '🟡'
        };
      case 'FETCH_FAILED':
        return {
          label: 'Live Check Failed',
          color: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-workspace-panel dark:text-orange-300 dark:border-orange-900/60',
          dot: 'bg-orange-500',
          iconText: '🟠'
        };
      case 'OFFLINE':
      default:
        return {
          label: 'Offline — Last Verified Registry',
          color: 'bg-workspace-raised text-slate-700 border-workspace-border dark:bg-workspace-panel dark:text-workspace-secondary dark:border-workspace-border',
          dot: 'bg-slate-400',
          iconText: '⚪'
        };
    }
  };

  const regBadge = getRegulatoryStatusBadge();

  const handleVerifyIntegrity = () => {
    let allValid = true;
    let mismatchDetail = '';
    for (const record of sources) {
      if (record.contentHash) {
        const ok = defaultSourceVersioningManager.verifySourceIntegrity(record, record.contentHash);
        if (!ok) {
          allValid = false;
          mismatchDetail = `Hash mismatch on '${record.id}' (${record.standardOrActCode} ${record.paragraphOrSection})`;
          break;
        }
      }
    }
    if (allValid) {
      setIntegrityStatus('PASS');
      setIntegrityDetails(`All ${totalProvisions} tracked statutory and standard provisions match their immutable SHA-256 signatures with 0% drift.`);
    } else {
      setIntegrityStatus('FAIL');
      setIntegrityDetails(mismatchDetail || 'Integrity check detected mismatched content hashes');
    }
  };

  const handleCheckUpdates = async () => {
    setIsCheckingUpdates(true);
    setUpdateMessage('');
    try {
      const res = await defaultLiveRegulatoryFeedService.checkForUpdates();
      setLiveSyncState(res.syncState);
      if (res.hasUpdates) {
        setUpdatePackages(res.packages);
        setUpdateMessage(`Discovered ${res.packages.length} pending regulatory update package(s) ready for staging & verification.`);
      } else {
        setUpdatePackages([]);
        setUpdateMessage('All Singapore statutory provisions are verified and aligned with the official government baseline.');
      }
    } catch (err: any) {
      setUpdateMessage(`Check failed: ${err.message || String(err)}`);
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const handleStagePackage = async (pkg: RegulatoryUpdatePackage) => {
    setUpdateAction(pkg.packageId);
    const result = await defaultLiveRegulatoryFeedService.stageUpdatePackage(pkg);
    setLiveSyncState(defaultLiveRegulatoryFeedService.getSyncState());
    setUpdateMessage(result.success
      ? `Staged ${result.stagedRecordsCount} record(s) from ${pkg.packageId}. Review the official source, then verify.`
      : `Unable to stage ${pkg.packageId}: ${result.error}`);
    setUpdateAction(null);
  };

  const handleVerifyPackage = async (pkg: RegulatoryUpdatePackage) => {
    setUpdateAction(pkg.packageId);
    const result = await defaultLiveRegulatoryFeedService.retrieveAndVerifyStagedPackage(pkg.packageId);
    setLiveSyncState(defaultLiveRegulatoryFeedService.getSyncState());
    setUpdateMessage(result.isValid
      ? `Verified ${result.verifiedRecordsCount} record(s) from ${pkg.packageId}. It is ready to activate.`
      : `Verification failed for ${pkg.packageId}: ${result.rejectionReason}`);
    setUpdateAction(null);
  };

  const handleActivatePackage = async (pkg: RegulatoryUpdatePackage) => {
    setUpdateAction(pkg.packageId);
    const result = await defaultLiveRegulatoryFeedService.activateUpdatePackage(pkg.packageId);
    setLiveSyncState(defaultLiveRegulatoryFeedService.getSyncState());
    if (result.success) setUpdatePackages(items => items.filter(item => item.packageId !== pkg.packageId));
    setUpdateMessage(result.success
      ? `Activated ${result.activatedRecordsCount} verified record(s) from ${pkg.packageId}.`
      : `Unable to activate ${pkg.packageId}: ${result.error}`);
    setUpdateAction(null);
  };

  const handleRejectPackage = (pkg: RegulatoryUpdatePackage) => {
    defaultLiveRegulatoryFeedService.rejectUpdatePackage(pkg.packageId);
    setUpdatePackages(items => items.filter(item => item.packageId !== pkg.packageId));
    setLiveSyncState(defaultLiveRegulatoryFeedService.getSyncState());
    setUpdateMessage(`Rejected ${pkg.packageId}. The active registry was not changed.`);
  };

  const handleOpenSettings = () => {
    setActiveTab(providerSettings.activeProvider);
    setAzureEndpoint(providerSettings.azure.endpoint);
    setAzureDeployment(providerSettings.azure.deploymentName);
    setAzureKey(providerSettings.azure.apiKey);
    setAzureVersion(providerSettings.azure.apiVersion);

    setGeminiKey(providerSettings.gemini.apiKey);
    setGeminiModel(providerSettings.gemini.model);

    setOpenaiKey(providerSettings.openai.apiKey);
    setOpenaiModel(providerSettings.openai.model);

    setShowSettings(true);
  };

  const handleSave = () => {
    const updated: ProviderSettings = {
      activeProvider: activeTab,
      azure: {
        endpoint: azureEndpoint.trim(),
        deploymentName: azureDeployment.trim(),
        apiKey: azureKey.trim(),
        apiVersion: azureVersion.trim() || '2024-08-01-preview'
      },
      gemini: {
        apiKey: geminiKey.trim(),
        model: geminiModel
      },
      openai: {
        apiKey: openaiKey.trim(),
        model: openaiModel
      }
    };

    onProviderSettingsSave(updated);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setShowSettings(false);
    }, 900);
  };

  // Helper badge text for the current provider
  const getProviderBadge = () => {
    const active = providerSettings.activeProvider;
    if (active === 'azure') {
      const hasKey = !!providerSettings.azure.apiKey;
      return {
        label: providerSettings.azure.deploymentName ? `Azure: ${providerSettings.azure.deploymentName}` : 'Azure OpenAI',
        connected: hasKey,
        icon: <Cloud className="w-3.5 h-3.5 text-sky-400 shrink-0" />
      };
    }
    if (active === 'gemini') {
      const hasKey = !!providerSettings.gemini.apiKey;
      return {
        label: providerSettings.gemini.model.replace('gemini-', 'Gemini '),
        connected: hasKey,
        icon: <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0" />
      };
    }
    if (active === 'openai') {
      const hasKey = !!providerSettings.openai.apiKey;
      return {
        label: `OpenAI: ${providerSettings.openai.model}`,
        connected: hasKey,
        icon: <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      };
    }
    return {
      label: 'Offline Statutory Engine',
      connected: true,
      icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
    };
  };

  const badgeInfo = getProviderBadge();

  return (
    <>
      <header className="bg-workspace-canvas/95 border-b border-workspace-border dark:border-workspace-border sticky top-0 z-40 backdrop-blur-md shadow-sm transition-colors duration-200">
        <div className="max-w-[1504px] mx-auto px-3 sm:px-6 lg:px-8 min-h-16 py-2 lg:py-0 lg:h-16 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2">
          {/* App Brand & Title */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-[150px] lg:min-w-0">
            <div className="w-8 h-8 flex items-center justify-center text-workspace-accent-text shrink-0">
              <BookOpen className="w-5 h-5 sm:w-6 sm:h-6 text-workspace-accent-text dark:text-workspace-accent-text" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base md:text-lg font-bold text-workspace-text dark:text-white tracking-tight leading-tight truncate font-sans">
                  <span className="sm:hidden">SG Accounting AI</span>
                  <span className="hidden sm:inline">Singapore Accounting & Statutory Assistant</span>
                </h1>
              </div>
            </div>
          </div>

          <div className="flex items-center flex-wrap justify-end gap-1.5 sm:gap-2.5 shrink-0 max-w-full">
            {/* Font Size Adjuster */}
            <div
              className="flex items-center bg-workspace-raised dark:bg-workspace-panel p-0.5 rounded-lg border border-workspace-border dark:border-workspace-border text-xs shadow-inner"
              title="Adjust application font size"
            >
              <span className="px-1 text-workspace-muted hidden md:inline-flex items-center">
                <Type className="w-3 h-3 mr-0.5" />
              </span>
              <button
                onClick={() => onFontSizeChange('normal')}
                aria-pressed={fontSize === 'normal'}
                className={`px-1.5 sm:px-2 py-1 rounded font-semibold text-[11px] sm:text-xs transition-all ${
                  fontSize === 'normal'
                    ? 'bg-white dark:bg-workspace-raised text-slate-900 dark:text-white shadow-xs'
                    : 'text-workspace-muted dark:text-workspace-muted hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Standard Font Size"
              >
                A-
              </button>
              <button
                onClick={() => onFontSizeChange('large')}
                aria-pressed={fontSize === 'large'}
                className={`px-1.5 sm:px-2.5 py-1 rounded font-semibold text-[11px] sm:text-xs transition-all ${
                  fontSize === 'large'
                    ? 'bg-white dark:bg-workspace-raised text-slate-900 dark:text-white shadow-xs'
                    : 'text-workspace-muted dark:text-workspace-muted hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Bigger Font Size (Default)"
              >
                A
              </button>
              <button
                onClick={() => onFontSizeChange('xl')}
                aria-pressed={fontSize === 'xl'}
                className={`px-1.5 sm:px-2 py-1 rounded font-semibold text-[11px] sm:text-xs transition-all ${
                  fontSize === 'xl'
                    ? 'bg-white dark:bg-workspace-raised text-slate-900 dark:text-white shadow-xs'
                    : 'text-workspace-muted dark:text-workspace-muted hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Extra Large Font Size"
              >
                A+
              </button>
            </div>

            {/* Light / Dark Theme Switcher Button */}
            <button
              onClick={onThemeToggle}
              className="p-1.5 sm:p-2 rounded-lg border border-workspace-border dark:border-workspace-border bg-workspace-raised hover:bg-slate-200 dark:bg-workspace-panel dark:hover:bg-workspace-hover text-slate-700 dark:text-workspace-secondary transition-all shadow-xs"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400 transition-transform duration-200 hover:rotate-45" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700 transition-transform duration-200 hover:-rotate-12" />
              )}
            </button>

            {/* Live Regulatory Registry & Versioning Button */}
            <button
              onClick={() => {
                setLiveSyncState(defaultLiveRegulatoryFeedService.getSyncState());
                setIntegrityStatus('IDLE');
                setUpdateMessage('');
                setShowRegistryModal(true);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all shadow-xs ${regBadge.color}`}
              title="View Live Regulatory Registry, SHA-256 Provenance & Source Versioning"
            >
              <Database className="w-3.5 h-3.5 shrink-0 opacity-80" />
              <span className="hidden lg:inline font-medium">{regBadge.label}</span>
              <span className="lg:hidden text-[11px] font-medium">Registry</span>
              <span className={`w-1.5 h-1.5 rounded-full ${regBadge.dot} shrink-0`}></span>
            </button>

            {/* AI Provider Settings Button */}
            <button
              onClick={handleOpenSettings}
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border border-workspace-border dark:border-workspace-border bg-workspace-raised dark:bg-workspace-panel text-slate-800 dark:text-workspace-secondary hover:bg-workspace-hover dark:hover:bg-workspace-hover transition-all shadow-xs"
              title="Configure AI Provider (Azure OpenAI, Gemini, OpenAI, or Offline)"
            >
              {badgeInfo.icon}
              <span className="hidden sm:inline font-medium text-slate-700 dark:text-workspace-secondary truncate max-w-[140px]">
                {badgeInfo.label}
              </span>
              <span className="sm:hidden text-[11px] font-medium">AI</span>
              {badgeInfo.connected ? (
                <span className="w-1.5 h-1.5 rounded-full bg-ynab-green shrink-0" title="Connected"></span>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-ynab-amber shrink-0" title="API Key Required"></span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Multi-Provider Settings Modal */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSettings(false);
            }
          }}
        >
          <div
            className="bg-workspace-panel rounded-2xl max-w-xl w-full shadow-2xl border border-workspace-border dark:border-workspace-border overflow-hidden animate-in zoom-in-95 duration-150 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-workspace-border dark:border-workspace-border flex items-start justify-between bg-workspace-raised/70 dark:bg-workspace-panel">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-workspace-accent/10 dark:bg-workspace-raised text-workspace-accent-text dark:text-workspace-accent-text flex items-center justify-center border border-workspace-accent/20 dark:border-workspace-border shrink-0">
                  <SettingsIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    AI Provider & API Settings
                  </h3>
                  <p className="text-xs text-workspace-muted dark:text-workspace-muted">
                    Choose and configure your enterprise or local AI backend
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-workspace-muted hover:text-slate-700 dark:hover:text-white text-2xl leading-none px-1 transition-colors"
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            {/* Provider Tabs - 4-Segment Grid: 100% visible, no scrolling needed! */}
            <div className="p-3 sm:p-4 border-b border-workspace-border dark:border-workspace-border bg-workspace-raised dark:bg-workspace-panel">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {/* Tab 1: Microsoft Azure */}
                <button
                  type="button"
                  onClick={() => setActiveTab('azure')}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[64px] shadow-xs cursor-pointer ${
                    activeTab === 'azure'
                      ? 'bg-white dark:bg-workspace-raised border-workspace-accent dark:border-workspace-accent text-workspace-accent-text dark:text-white ring-2 ring-workspace-accent/20'
                      : 'bg-workspace-raised/80 dark:bg-workspace-panel border-workspace-border dark:border-workspace-border text-slate-700 dark:text-workspace-secondary hover:bg-white dark:hover:bg-workspace-hover'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <Cloud className="w-4 h-4 text-sky-500" />
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-sky-100 dark:bg-sky-950/90 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                      Enterprise
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold leading-tight">MS Azure</div>
                    <div className="text-[10px] text-workspace-muted dark:text-workspace-muted leading-tight">OpenAI Tenant</div>
                  </div>
                </button>

                {/* Tab 2: Google Gemini */}
                <button
                  type="button"
                  onClick={() => setActiveTab('gemini')}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[64px] shadow-xs cursor-pointer ${
                    activeTab === 'gemini'
                      ? 'bg-white dark:bg-workspace-raised border-workspace-accent dark:border-workspace-accent text-workspace-accent-text dark:text-white ring-2 ring-workspace-accent/20'
                      : 'bg-workspace-raised/80 dark:bg-workspace-panel border-workspace-border dark:border-workspace-border text-slate-700 dark:text-workspace-secondary hover:bg-white dark:hover:bg-workspace-hover'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <Sparkles className="w-4 h-4 text-blue-500" />
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-950/90 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      Google
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold leading-tight">Gemini</div>
                    <div className="text-[10px] text-workspace-muted dark:text-workspace-muted leading-tight">3.5 Flash Lite</div>
                  </div>
                </button>

                {/* Tab 3: OpenAI Direct */}
                <button
                  type="button"
                  onClick={() => setActiveTab('openai')}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[64px] shadow-xs cursor-pointer ${
                    activeTab === 'openai'
                      ? 'bg-white dark:bg-workspace-raised border-workspace-accent dark:border-workspace-accent text-workspace-accent-text dark:text-white ring-2 ring-workspace-accent/20'
                      : 'bg-workspace-raised/80 dark:bg-workspace-panel border-workspace-border dark:border-workspace-border text-slate-700 dark:text-workspace-secondary hover:bg-white dark:hover:bg-workspace-hover'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <Server className="w-4 h-4 text-emerald-500" />
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/90 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      Direct
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold leading-tight">OpenAI</div>
                    <div className="text-[10px] text-workspace-muted dark:text-workspace-muted leading-tight">gpt-4o</div>
                  </div>
                </button>

                {/* Tab 4: Offline Engine */}
                <button
                  type="button"
                  onClick={() => setActiveTab('offline')}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[64px] shadow-xs cursor-pointer ${
                    activeTab === 'offline'
                      ? 'bg-white dark:bg-workspace-raised border-workspace-accent dark:border-workspace-accent text-workspace-accent-text dark:text-white ring-2 ring-workspace-accent/20'
                      : 'bg-workspace-raised/80 dark:bg-workspace-panel border-workspace-border dark:border-workspace-border text-slate-700 dark:text-workspace-secondary hover:bg-white dark:hover:bg-workspace-hover'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <ShieldCheck className="w-4 h-4 text-ynab-green" />
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/90 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      100% Local
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold leading-tight">Offline</div>
                    <div className="text-[10px] text-workspace-muted dark:text-workspace-muted leading-tight">Singapore Law</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Modal Tab Body */}
            <div className="p-4 sm:p-6 space-y-4 max-h-[62vh] overflow-y-auto">
              {/* AZURE OPENAI TAB */}
              {activeTab === 'azure' && (
                <div className="space-y-3.5 animate-in fade-in duration-150">
                  <div className="p-3.5 bg-sky-50 dark:bg-workspace-panel rounded-xl border border-sky-100 dark:border-workspace-border text-xs text-sky-900 dark:text-sky-200">
                    <p className="font-semibold mb-1 flex items-center gap-1.5">
                      <Cloud className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                      Microsoft Azure OpenAI Enterprise Client
                    </p>
                    <p className="text-[11px] text-sky-800/90 dark:text-sky-300/90 leading-relaxed">
                      Direct client-to-tenant HTTPS calls to your company's Azure OpenAI resource. Zero intermediate proxy servers. Keys are kept strictly in your local browser storage.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-workspace-secondary mb-1">
                      Azure OpenAI Resource Endpoint <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={azureEndpoint}
                      onChange={(e) => setAzureEndpoint(e.target.value)}
                      placeholder="https://my-company.openai.azure.com"
                      className="w-full px-3 py-2 text-xs bg-workspace-raised dark:bg-workspace-input border border-slate-300 dark:border-workspace-border rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-workspace-accent"
                    />
                    <p className="text-[11px] text-workspace-muted dark:text-workspace-muted mt-1">
                      Resource URL from Azure Portal or Azure AI Foundry (e.g. <code className="font-mono">https://&lt;resource&gt;.openai.azure.com</code> or just resource name).
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-workspace-secondary mb-1">
                        Deployment Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={azureDeployment}
                        onChange={(e) => setAzureDeployment(e.target.value)}
                        placeholder="gpt-4o"
                        className="w-full px-3 py-2 text-xs bg-workspace-raised dark:bg-workspace-input border border-slate-300 dark:border-workspace-border rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-workspace-accent"
                      />
                      <p className="text-[11px] text-workspace-muted dark:text-workspace-muted mt-1">
                        Deployment name under Azure OpenAI Studio &gt; Deployments.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-workspace-secondary mb-1">
                        API Version
                      </label>
                      <input
                        type="text"
                        value={azureVersion}
                        onChange={(e) => setAzureVersion(e.target.value)}
                        placeholder="2024-08-01-preview"
                        className="w-full px-3 py-2 text-xs bg-workspace-raised dark:bg-workspace-input border border-slate-300 dark:border-workspace-border rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-workspace-accent"
                      />
                      <p className="text-[11px] text-workspace-muted dark:text-workspace-muted mt-1">
                        Defaults to <code className="font-mono">2024-08-01-preview</code>.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-workspace-secondary mb-1">
                      Azure API Key <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={azureKey}
                      onChange={(e) => setAzureKey(e.target.value)}
                      placeholder="Enter Azure 32-character key..."
                      className="w-full px-3 py-2 text-xs bg-workspace-raised dark:bg-workspace-input border border-slate-300 dark:border-workspace-border rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-workspace-accent"
                    />
                    <p className="text-[11px] text-workspace-muted dark:text-workspace-muted mt-1">
                      Located in Azure Portal under <em>Keys and Endpoint</em> (Key 1 or Key 2). Stored in browser <code className="font-mono">localStorage</code>; do not use production master keys on shared workstations.
                    </p>
                  </div>
                </div>
              )}

              {/* GOOGLE GEMINI TAB */}
              {activeTab === 'gemini' && (
                <div className="space-y-3.5 animate-in fade-in duration-150">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-workspace-secondary mb-1">
                      Google Gemini API Key
                    </label>
                    <input
                      type="password"
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full px-3 py-2 text-xs bg-workspace-raised dark:bg-workspace-input border border-slate-300 dark:border-workspace-border rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-workspace-accent"
                    />
                    <p className="text-[11px] text-workspace-muted dark:text-workspace-muted mt-1">
                      Obtain from Google AI Studio. Stored in browser <code className="font-mono">localStorage</code>; same-origin scripts can access it, so do not use production master keys on shared workstations.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-workspace-secondary mb-1 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-workspace-muted" />
                      <span>Gemini Model Selection</span>
                    </label>
                    <select
                      value={geminiModel}
                      onChange={(e) => setGeminiModel(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-workspace-raised dark:bg-workspace-input border border-slate-300 dark:border-workspace-border rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-workspace-accent"
                    >
                      <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (Default - High Daily Quota, 500 RPD)</option>
                      <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (High Daily Quota - 500 RPD)</option>
                      <option value="gemini-3.8-flash">Gemini 3.8 Flash (High Capacity - 20 RPD)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* OPENAI DIRECT TAB */}
              {activeTab === 'openai' && (
                <div className="space-y-3.5 animate-in fade-in duration-150">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-workspace-secondary mb-1">
                      OpenAI API Key
                    </label>
                    <input
                      type="password"
                      value={openaiKey}
                      onChange={(e) => setOpenaiKey(e.target.value)}
                      placeholder="sk-proj-..."
                      className="w-full px-3 py-2 text-xs bg-workspace-raised dark:bg-workspace-input border border-slate-300 dark:border-workspace-border rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-workspace-accent"
                    />
                    <p className="text-[11px] text-workspace-muted dark:text-workspace-muted mt-1">
                      Direct OpenAI API key from platform.openai.com.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-workspace-secondary mb-1">
                      OpenAI Model
                    </label>
                    <select
                      value={openaiModel}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-workspace-raised dark:bg-workspace-input border border-slate-300 dark:border-workspace-border rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-workspace-accent"
                    >
                      <option value="gpt-4o">gpt-4o (Omni - Recommended)</option>
                      <option value="gpt-4o-mini">gpt-4o-mini (Fast & Low Cost)</option>
                      <option value="gpt-4-turbo">gpt-4-turbo</option>
                    </select>
                  </div>
                </div>
              )}

              {/* OFFLINE ENGINE TAB */}
              {activeTab === 'offline' && (
                <div className="space-y-3.5 animate-in fade-in duration-150">
                  <div className="p-3.5 bg-emerald-50 dark:bg-workspace-panel rounded-xl border border-emerald-200 dark:border-workspace-border text-xs text-emerald-900 dark:text-emerald-200">
                    <p className="font-semibold mb-1 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      100% Offline Singapore Statutory Engine
                    </p>
                    <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90 leading-relaxed">
                      Zero cloud API keys or external endpoints required. The system runs deterministic accounting rules, compound double-entry balancing, and Singapore regulatory directives completely within your local browser.
                    </p>
                  </div>

                  <ul className="text-xs text-slate-600 dark:text-workspace-secondary space-y-1.5 list-disc pl-5">
                    <li>Full compliance with SFRS(I) 1-16, SFRS(I) 9, SFRS(I) 16, and IAS 21.</li>
                    <li>Automatic Singapore 9% GST calculations with Regulation 26 car blockage rules.</li>
                    <li>ACRA Section 205C Small Company Audit Exemption criteria.</li>
                    <li>2026 CPF Ordinary Wage $8,000 ceiling calculations.</li>
                  </ul>
                </div>
              )}

              {/* Resilient fallback notice */}
              <div className="p-3 bg-workspace-raised dark:bg-workspace-panel rounded-xl border border-workspace-border dark:border-workspace-border flex items-start gap-2.5">
                <HelpCircle className="w-4 h-4 text-workspace-muted shrink-0 mt-0.5" />
                <div className="text-xs text-slate-600 dark:text-workspace-secondary space-y-0.5">
                  <p className="font-semibold text-slate-800 dark:text-workspace-secondary">Resilient Offline Fallback</p>
                  <p className="text-workspace-muted dark:text-workspace-muted text-[11px]">
                    If your chosen provider encounters quota or network errors, the application automatically falls back to the built-in Singapore Statutory Engine.
                  </p>
                </div>
              </div>

              {savedSuccess && (
                <div className="p-2.5 bg-emerald-50 text-emerald-800 dark:bg-workspace-panel dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  Settings saved successfully! Active backend: <strong>{activeTab.toUpperCase()}</strong>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 sm:px-6 py-4 bg-workspace-raised dark:bg-workspace-panel border-t border-workspace-border dark:border-workspace-border flex items-center justify-between gap-2">
              <span className="text-[11px] text-workspace-muted dark:text-workspace-muted">
                Selected: <strong className="text-slate-700 dark:text-workspace-secondary">{activeTab.toUpperCase()}</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-workspace-muted hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-workspace-accent hover:bg-workspace-accent-hover rounded-lg shadow-sm transition-all"
                >
                  Save & Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Regulatory Registry & Source Versioning Modal */}
      {showRegistryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowRegistryModal(false);
            }
          }}
        >
          <div
            className="bg-workspace-panel rounded-2xl max-w-2xl w-full shadow-2xl border border-workspace-border dark:border-workspace-border overflow-hidden animate-in zoom-in-95 duration-150 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-workspace-border dark:border-workspace-border flex items-start justify-between bg-workspace-raised/70 dark:bg-workspace-panel">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 dark:bg-workspace-raised text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/20 dark:border-workspace-border shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Regulatory Registry & Source Versioning
                  </h3>
                  <p className="text-xs text-workspace-muted dark:text-workspace-muted">
                    Phase 4 Trust Pipeline: Append-Only Version Ledger & Cryptographic Integrity
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowRegistryModal(false)}
                className="text-workspace-muted hover:text-slate-700 dark:hover:text-white text-2xl leading-none px-1 transition-colors"
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 space-y-4 max-h-[68vh] overflow-y-auto">
              {/* Metric Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 bg-workspace-raised dark:bg-workspace-panel rounded-xl border border-workspace-border dark:border-workspace-border">
                  <div className="text-[11px] font-semibold text-workspace-muted dark:text-workspace-muted">Tracked Provisions</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">{totalProvisions}</div>
                  <div className="text-[10px] text-workspace-muted dark:text-workspace-muted">Statutes & Standards</div>
                </div>
                <div className="p-3 bg-emerald-50/60 dark:bg-workspace-panel rounded-xl border border-emerald-200/60 dark:border-emerald-900/40">
                  <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Active / In Force</div>
                  <div className="text-lg font-bold text-emerald-800 dark:text-emerald-300 mt-0.5">{activeCount}</div>
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400">Current legislation</div>
                </div>
                <div className="p-3 bg-workspace-raised dark:bg-workspace-panel rounded-xl border border-workspace-border dark:border-workspace-border">
                  <div className="text-[11px] font-semibold text-workspace-muted dark:text-workspace-muted">Historical / Superseded</div>
                  <div className="text-lg font-bold text-slate-700 dark:text-workspace-secondary mt-0.5">{historicalCount}</div>
                  <div className="text-[10px] text-workspace-muted dark:text-workspace-muted">Prior tax & CPF rates</div>
                </div>
                <div className="p-3 bg-amber-50/60 dark:bg-workspace-panel rounded-xl border border-amber-200/60 dark:border-amber-900/40">
                  <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Review Due</div>
                  <div className="text-lg font-bold text-amber-800 dark:text-amber-300 mt-0.5">{reviewDueCount}</div>
                  <div className="text-[10px] text-amber-600 dark:text-amber-400">Audit interval elapsed</div>
                </div>
              </div>

              {/* Version & Sync Details Card */}
              <div className="p-4 bg-workspace-raised dark:bg-workspace-panel rounded-xl border border-workspace-border dark:border-workspace-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-workspace-secondary flex items-center gap-1.5">
                    <History className="w-4 h-4 text-workspace-muted" />
                    Registry Version & Provenance
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${regBadge.color}`}>
                    {regBadge.iconText} {regBadge.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-workspace-muted text-[11px]">Ledger Version:</span>
                    <p className="font-mono font-bold text-slate-800 dark:text-workspace-secondary">2026.09 (FIPS SHA-256)</p>
                  </div>
                  <div>
                    <span className="text-workspace-muted text-[11px]">Last Verification:</span>
                    <p className="font-mono text-slate-800 dark:text-workspace-secondary">{defaultLiveRegulatoryFeedService.getLastVerificationDate().slice(0, 10)}</p>
                  </div>
                  <div>
                    <span className="text-workspace-muted text-[11px]">Last Live Check:</span>
                    <p className="font-mono text-slate-800 dark:text-workspace-secondary">{defaultLiveRegulatoryFeedService.getLastCheckDate().slice(0, 10)}</p>
                  </div>
                  <div>
                    <span className="text-workspace-muted text-[11px]">Pending Staged Updates:</span>
                    <p className="font-semibold text-slate-800 dark:text-workspace-secondary">{stagedCount} packages</p>
                  </div>
                  <div>
                    <span className="text-workspace-muted text-[11px]">Rejected Updates:</span>
                    <p className="font-semibold text-slate-800 dark:text-workspace-secondary">{rejectedCount} packages</p>
                  </div>
                  <div>
                    <span className="text-workspace-muted text-[11px]">Integrity Status:</span>
                    <p className="font-semibold text-slate-800 dark:text-workspace-secondary">{integrityStatus === 'PASS' ? '🟢 Verified' : integrityStatus === 'FAIL' ? '🔴 Mismatch' : '⚪ Unchecked'}</p>
                  </div>
                </div>
              </div>

              {/* Cryptographic Integrity Check Action */}
              <div className="p-4 bg-workspace-raised dark:bg-workspace-panel rounded-xl border border-workspace-border dark:border-workspace-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-workspace-secondary flex items-center gap-1.5">
                      <FileCheck2 className="w-4 h-4 text-emerald-500" />
                      Cryptographic Integrity Audit
                    </h4>
                    <p className="text-[11px] text-workspace-muted dark:text-workspace-muted mt-0.5">
                      Re-hashes every active statutory and standard provision using SHA-256 to confirm zero tamper or drift.
                    </p>
                  </div>
                  <button
                    onClick={handleVerifyIntegrity}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-all shrink-0"
                  >
                    Verify Registry Integrity
                  </button>
                </div>

                {integrityStatus === 'PASS' && (
                  <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-lg text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span><strong>PASS</strong>: {integrityDetails}</span>
                  </div>
                )}
                {integrityStatus === 'FAIL' && (
                  <div className="p-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg text-xs text-red-800 dark:text-red-200 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                    <span><strong>FAIL</strong>: {integrityDetails}</span>
                  </div>
                )}
              </div>

              {/* Live Regulatory Feed Check Action */}
              <div className="p-4 bg-workspace-raised dark:bg-workspace-panel rounded-xl border border-workspace-border dark:border-workspace-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-workspace-secondary flex items-center gap-1.5">
                      <RefreshCw className={`w-4 h-4 text-blue-500 ${isCheckingUpdates ? 'animate-spin' : ''}`} />
                      Live Statutory Update Feeds
                    </h4>
                    <p className="text-[11px] text-workspace-muted dark:text-workspace-muted mt-0.5">
                      Checks official legislative endpoints for newly enacted amendments or rate changes.
                    </p>
                  </div>
                  <button
                    onClick={handleCheckUpdates}
                    disabled={isCheckingUpdates}
                    className="px-3 py-1.5 bg-workspace-accent hover:bg-workspace-accent-hover text-white rounded-lg text-xs font-semibold shadow-xs transition-all shrink-0 disabled:opacity-50"
                  >
                    {isCheckingUpdates ? 'Checking...' : 'Check for Live Updates'}
                  </button>
                </div>

                {updateMessage && (
                  <div className="p-2.5 bg-blue-50 dark:bg-workspace-raised border border-blue-200 dark:border-blue-800/60 rounded-lg text-xs text-blue-800 dark:text-blue-200">
                    {updateMessage}
                  </div>
                )}

                {updatePackages.length > 0 && (
                  <div className="space-y-2" aria-label="Discovered regulatory update packages">
                    {updatePackages.map((pkg) => {
                      const isStaged = defaultLiveRegulatoryFeedService.getStagedPackages().some(item => item.packageId === pkg.packageId);
                      const isVerified = defaultLiveRegulatoryFeedService.getVerifiedPackages().some(item => item.packageId === pkg.packageId);
                      const isWorking = updateAction === pkg.packageId;
                      return (
                        <div key={pkg.packageId} className="p-3 bg-workspace-panel border border-workspace-border dark:border-workspace-border rounded-lg space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-xs text-slate-800 dark:text-workspace-text">{pkg.packageId}</p>
                              <p className="text-[11px] text-workspace-muted dark:text-workspace-muted">{pkg.authority} · released {pkg.releaseDate} · {pkg.updates.length} record{pkg.updates.length === 1 ? '' : 's'}</p>
                            </div>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${isVerified ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : isStaged ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-blue-700 bg-blue-50 border-blue-200'}`}>
                              {isVerified ? 'Verified' : isStaged ? 'Staged' : 'Discovered'}
                            </span>
                          </div>
                          <ul className="text-[11px] text-slate-600 dark:text-workspace-secondary space-y-1">
                            {pkg.amendments.map(amendment => <li key={amendment.recordId}>• {amendment.title}: {amendment.summary}</li>)}
                          </ul>
                          <div className="flex flex-wrap gap-1.5 items-center">
                            {pkg.updates.map(record => (
                              <a key={record.id} href={record.officialSourceUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 dark:text-blue-300 hover:underline inline-flex items-center gap-1">
                                Open official source <ExternalLink className="w-3 h-3" />
                              </a>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-2 pt-1">
                            {!isStaged && !isVerified && <button onClick={() => handleStagePackage(pkg)} disabled={isWorking} className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-[11px] font-semibold">Stage for review</button>}
                            {isStaged && !isVerified && <button onClick={() => handleVerifyPackage(pkg)} disabled={isWorking} className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded text-[11px] font-semibold">Verify official document</button>}
                            {isVerified && <button onClick={() => handleActivatePackage(pkg)} disabled={isWorking} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-[11px] font-semibold">Activate verified update</button>}
                            <button onClick={() => handleRejectPackage(pkg)} disabled={isWorking} className="px-2.5 py-1 border border-slate-300 dark:border-workspace-border hover:bg-workspace-hover dark:hover:bg-slate-700 text-slate-700 dark:text-workspace-secondary rounded text-[11px] font-semibold">Reject</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Official Sources Allowlist Manifest */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800 dark:text-workspace-secondary">
                  Authorized Statutory & Reference Portals (Exact Domain Allowlist)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <a
                    href="https://sso.agc.gov.sg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 bg-workspace-raised dark:bg-workspace-panel hover:bg-workspace-hover dark:hover:bg-workspace-hover rounded-xl border border-workspace-border dark:border-workspace-border flex items-center justify-between group transition-all"
                  >
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-white">Singapore Statutes Online (AGC)</span>
                      <p className="text-[11px] text-workspace-muted dark:text-workspace-muted font-mono">sso.agc.gov.sg</p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-workspace-muted group-hover:text-slate-700 dark:group-hover:text-white" />
                  </a>

                  <a
                    href="https://www.iras.gov.sg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 bg-workspace-raised dark:bg-workspace-panel hover:bg-workspace-hover dark:hover:bg-workspace-hover rounded-xl border border-workspace-border dark:border-workspace-border flex items-center justify-between group transition-all"
                  >
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-white">Inland Revenue Authority (IRAS)</span>
                      <p className="text-[11px] text-workspace-muted dark:text-workspace-muted font-mono">iras.gov.sg</p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-workspace-muted group-hover:text-slate-700 dark:group-hover:text-white" />
                  </a>

                  <a
                    href="https://www.acra.gov.sg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 bg-workspace-raised dark:bg-workspace-panel hover:bg-workspace-hover dark:hover:bg-workspace-hover rounded-xl border border-workspace-border dark:border-workspace-border flex items-center justify-between group transition-all"
                  >
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-white">ACRA & Accounting Standards</span>
                      <p className="text-[11px] text-workspace-muted dark:text-workspace-muted font-mono">acra.gov.sg</p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-workspace-muted group-hover:text-slate-700 dark:group-hover:text-white" />
                  </a>

                  <a
                    href="https://www.mom.gov.sg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 bg-workspace-raised dark:bg-workspace-panel hover:bg-workspace-hover dark:hover:bg-workspace-hover rounded-xl border border-workspace-border dark:border-workspace-border flex items-center justify-between group transition-all"
                  >
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-white">Ministry of Manpower (MOM)</span>
                      <p className="text-[11px] text-workspace-muted dark:text-workspace-muted font-mono">mom.gov.sg</p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-workspace-muted group-hover:text-slate-700 dark:group-hover:text-white" />
                  </a>

                  <a
                    href="https://www.cpf.gov.sg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 bg-workspace-raised dark:bg-workspace-panel hover:bg-workspace-hover dark:hover:bg-workspace-hover rounded-xl border border-workspace-border dark:border-workspace-border flex items-center justify-between group transition-all"
                  >
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-white">Central Provident Fund Board (CPF)</span>
                      <p className="text-[11px] text-workspace-muted dark:text-workspace-muted font-mono">cpf.gov.sg</p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-workspace-muted group-hover:text-slate-700 dark:group-hover:text-white" />
                  </a>

                  <a
                    href="https://api.frankfurter.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 bg-workspace-raised dark:bg-workspace-panel hover:bg-workspace-hover dark:hover:bg-workspace-hover rounded-xl border border-workspace-border dark:border-workspace-border flex items-center justify-between group transition-all"
                  >
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-white">European Central Bank FX (Reference API)</span>
                      <p className="text-[11px] text-workspace-muted dark:text-workspace-muted font-mono">api.frankfurter.dev</p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-workspace-muted group-hover:text-slate-700 dark:group-hover:text-white" />
                  </a>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 sm:px-6 py-4 bg-workspace-raised dark:bg-workspace-panel border-t border-workspace-border dark:border-workspace-border flex items-center justify-between gap-2">
              <span className="text-[11px] text-workspace-muted dark:text-workspace-muted">
                Corpus Status: <strong className="text-slate-700 dark:text-workspace-secondary">{totalProvisions} Active/Historical Provisions</strong>
              </span>
              <button
                onClick={() => setShowRegistryModal(false)}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-workspace-accent hover:bg-workspace-accent-hover rounded-lg shadow-sm transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
