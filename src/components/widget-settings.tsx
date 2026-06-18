'use client';

import { useState } from 'react';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Slider } from '../ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { useChatTheme, fontOptions } from '../hooks/use-chat-theme';
import { RotateCcw, Settings, Palette, Plus, Trash2 } from 'lucide-react';
import { cn } from '../utils/cn';
import { MODELS } from '../utils/models';

type Tab = 'configuration' | 'appearance';

export function WidgetSettings() {
  const [activeTab, setActiveTab] = useState<Tab>('configuration');
  const {
    theme,
    updateLightColors,
    updateDarkColors,
    resetTheme,
    updateFontSize,
    updateFontFamily,
    conversationStarters,
    updateConversationStarters,
    model,
    updateModel,
    systemPrompt,
    updateSystemPrompt,
    temperature,
    updateTemperature,
    themeMode,
    updateThemeMode
  } = useChatTheme();
  const [newStarter, setNewStarter] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const addConversationStarter = () => {
    if (newStarter.trim()) {
      updateConversationStarters([...conversationStarters, { text: newStarter.trim(), enabled: true }]);
      setNewStarter('');
      setIsDialogOpen(false);
    }
  };

  const toggleConversationStarter = (index: number) => {
    const updated = conversationStarters.map((starter, i) =>
      i === index ? { ...starter, enabled: !starter.enabled } : starter
    );
    updateConversationStarters(updated);
  };

  const removeConversationStarter = (index: number) => {
    updateConversationStarters(conversationStarters.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      {/* Compact Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 m-0 leading-tight">
          Chat Studio
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 m-0 mt-0.5">
          Design the agent you need in minutes
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-gray-100/80 dark:bg-gray-800/80 rounded-lg">
        <button
          onClick={() => setActiveTab('configuration')}
          className={cn(
            "flex-1 flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
            activeTab === 'configuration'
              ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          )}
          title="Configuration"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          onClick={() => setActiveTab('appearance')}
          className={cn(
            "flex-1 flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
            activeTab === 'appearance'
              ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          )}
          title="Appearance"
        >
          <Palette className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="space-y-5">
        {activeTab === 'configuration' && (
          <>
            {/* Model Selection Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                Model
              </h3>
              <Select value={model} onValueChange={updateModel}>
                <SelectTrigger className="w-full h-9 text-sm">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent className="max-h-[240px]">
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* System Prompt Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                System Prompt
              </h3>
              <textarea
                value={systemPrompt}
                onChange={(e) => updateSystemPrompt(e.target.value)}
                placeholder="Enter your system prompt..."
                rows={4}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 transition-all resize-none"
              />
            </div>

            {/* Temperature Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                  Temperature
                </h3>
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  {temperature.toFixed(2)}
                </span>
              </div>
              <Slider
                value={[temperature]}
                onValueChange={(value) => updateTemperature(value[0])}
                min={0}
                max={1}
                step={0.05}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>Precise</span>
                <span>Balanced</span>
                <span>Creative</span>
              </div>
            </div>

            {/* Conversation Starters Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                  Conversation Starters
                </h3>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Add Conversation Starter</DialogTitle>
                      <DialogDescription>
                        Create a new suggested prompt for users to start conversations
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <input
                        type="text"
                        value={newStarter}
                        onChange={(e) => setNewStarter(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            addConversationStarter();
                          }
                        }}
                        placeholder="e.g., How can I help you today?"
                        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 transition-all"
                        autoFocus
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsDialogOpen(false);
                          setNewStarter('');
                        }}
                      >
                        Cancel
                      </Button>
                      <Button onClick={addConversationStarter} disabled={!newStarter.trim()}>
                        Add Starter
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Starters List */}
              <div className="space-y-2">
                {conversationStarters.map((starter, index) => (
                  <div
                    key={index}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border transition-all",
                      starter.enabled
                        ? "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
                        : "bg-gray-50 dark:bg-gray-800/30 border-gray-100 dark:border-gray-800"
                    )}
                  >
                    <Switch
                      checked={starter.enabled}
                      onCheckedChange={() => toggleConversationStarter(index)}
                    />
                    <span className={cn(
                      "flex-1 text-sm transition-colors",
                      starter.enabled
                        ? "text-gray-900 dark:text-gray-100"
                        : "text-gray-400 dark:text-gray-500"
                    )}>
                      {starter.text}
                    </span>
                    <button
                      onClick={() => removeConversationStarter(index)}
                      className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                      title="Delete starter"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'appearance' && (
          <>
            {/* Theme Mode */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                Theme
              </h3>
              <div className="flex items-center gap-1 p-1 bg-gray-100/80 dark:bg-gray-800/80 rounded-lg">
                <button
                  onClick={() => updateThemeMode('light')}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                    themeMode === 'light'
                      ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                  )}
                >
                  Light
                </button>
                <button
                  onClick={() => updateThemeMode('dark')}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                    themeMode === 'dark'
                      ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                  )}
                >
                  Dark
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose between light or dark theme for your chat widget
              </p>
            </div>


          </>
        )}
      </div>
    </div>
  );
}
