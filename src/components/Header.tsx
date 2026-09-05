import React, { useState } from 'react';
import { BookOpen, Key, Sparkles, CheckCircle2, ShieldCheck, HelpCircle, Globe, Cpu, Type } from 'lucide-react';

export type AppFontSize = 'normal' | 'large' | 'xl';

interface HeaderProps {
  apiKey: string;
  onApiKeySave: (key: string) => void;
  modelName: string;
  onModelChange: (model: string) => void;
  fontSize: AppFontSize;
  onFontSizeChange: (size: AppFontSize) => void;
}

export const Header: React.FC<HeaderProps> = ({
  apiKey,
  onApiKeySave,
  modelName,
  onModelChange,
  fontSize,
  onFontSizeChange
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);
  const [tempModel, setTempModel] = useState(modelName);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = () => {
    onApiKeySave(tempKey.trim());
    onModelChange(tempModel);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setShowSettings(false);
    }, 1200);
  };

  const getModelDisplayName = (m: string) => {
    if (m === 'gemini-3.5-flash-lite') return 'Gemini 3.5 Flash Lite';
    if (m === 'gemini-3.1-flash-lite') return 'Gemini 3.1 Flash Lite';
    if (m === 'gemini-3.8-flash') return 'Gemini 3.8 Flash';
    return m;
  };

  return (
    <>
      <header className="bg-slate-900/90 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight leading-none">
                  Accounting Double-Entry Assistant
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/80">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  SFRS(I) & IFRS Dual Compliant
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Universal Accounting Engine • Sourced from ASC Singapore & IASB (Singapore DD/MM/YYYY)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Frankfurter API Indicator */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/80 text-slate-300 text-xs font-medium" title="Live foreign exchange rates powered by Frankfurter API (ECB)">
              <Globe className="w-3.5 h-3.5 text-blue-400" />
              <span>ECB FX Live</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            </div>

            {/* Font Size Adjuster (Bigger Default with Standard, Large, XL Options) */}
            <div className="flex items-center bg-slate-800/90 p-0.5 rounded-lg border border-slate-700/80 text-xs shadow-inner" title="Adjust application font size">
              <span className="px-1.5 text-slate-400 hidden sm:inline-flex items-center">
                <Type className="w-3 h-3 text-slate-400 mr-0.5" />
              </span>
              <button
                onClick={() => onFontSizeChange('normal')}
                className={`px-2 py-1 rounded-md font-semibold transition-all ${
                  fontSize === 'normal'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Standard Font Size"
              >
                A-
              </button>
              <button
                onClick={() => onFontSizeChange('large')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                  fontSize === 'large'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Bigger Font Size (Default)"
              >
                A
              </button>
              <button
                onClick={() => onFontSizeChange('xl')}
                className={`px-2 py-1 rounded-md font-semibold transition-all ${
                  fontSize === 'xl'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Extra Large Font Size"
              >
                A+
              </button>
            </div>

            {/* Gemini API Key & Model Button */}
            <button
              onClick={() => {
                setTempKey(apiKey);
                setTempModel(modelName);
                setShowSettings(true);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                apiKey
                  ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700/80 hover:bg-indigo-900/80'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              {apiKey ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="font-semibold">{getModelDisplayName(modelName)}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  Connect Gemini API
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 rounded-2xl max-w-md w-full shadow-2xl border border-slate-800 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-800 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-950 text-indigo-400 flex items-center justify-center border border-indigo-800">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Gemini API & Model Settings</h3>
                  <p className="text-xs text-slate-400">Configure AI model and API credentials</p>
                </div>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* API Key Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Google Gemini API Key
                </label>
                <input
                  type="password"
                  value={tempKey}
                  onChange={(e) => setTempKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  Your key is stored strictly in your browser's <code className="text-blue-400">localStorage</code> and is sent directly to Google's API.
                </p>
              </div>

              {/* Model Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  <span>Gemini Model Selection</span>
                </label>
                <select
                  value={tempModel}
                  onChange={(e) => setTempModel(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (Default - High Daily Quota, 500 RPD)</option>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (High Daily Quota - 500 RPD)</option>
                  <option value="gemini-3.8-flash">Gemini 3.8 Flash (High Capacity - 20 RPD)</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Default is <strong>gemini-3.5-flash-lite</strong> with a generous 500 requests/day quota.
                </p>
              </div>

              <div className="p-3 bg-blue-950/40 rounded-xl border border-blue-900/60 flex items-start gap-2.5">
                <HelpCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="text-xs text-blue-200 space-y-1">
                  <p className="font-semibold">Offline Fallback</p>
                  <p className="text-blue-300 text-[11px]">
                    If no API key is provided, the app uses its built-in universal calculation engine and Frankfurter FX rates.
                  </p>
                </div>
              </div>

              {savedSuccess && (
                <div className="p-2.5 bg-emerald-950/60 text-emerald-300 border border-emerald-800 rounded-lg text-xs font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Settings saved successfully!
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-950/60 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/30"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
