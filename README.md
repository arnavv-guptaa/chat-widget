# @mordn/chat-widget

A customizable AI chat widget for React/Next.js applications with built-in conversation persistence.

## Quick Start

```bash
# 1. Install the package
npm install @mordn/chat-widget drizzle-kit

# 2. Run the setup wizard
npx @mordn/chat-widget
```

The setup wizard creates all required files:
- API routes (`/api/chat/...`)
- `drizzle.config.ts`
- `.env.example`

## Requirements

- Next.js 14+ (App Router)
- React 18+
- PostgreSQL database (Supabase recommended)
- Tailwind CSS v4

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env.local` and fill in your credentials:

```env
# Database (Required)
DATABASE_URL="postgresql://postgres.xxx:[PASSWORD]@aws-0-region.pooler.supabase.com:6543/postgres"

# AI Provider (Required)
AI_GATEWAY_API_KEY="your-ai-gateway-key"
```

### 2. Database Setup

Push the schema to your database:

```bash
npx drizzle-kit push
```

### 3. Configure Your AI Model

Open `app/api/chat/route.ts` and update the config:

```typescript
const DEVELOPER_CONFIG = {
  model: 'openai/gpt-4o', // Your AI model
  systemPrompt: 'You are a helpful assistant',
  temperature: 0.7,
};
```

### 4. Add the Widget

```tsx
'use client';

import { ChatWidget } from '@mordn/chat-widget';
import '@mordn/chat-widget/styles.css';

export default function Page() {
  return (
    <ChatWidget
      // Required
      userId="user-123"

      // Theme: 'light' | 'dark'
      theme={{ mode: 'light' }}

      // Feature toggles
      features={{
        fileUpload: false,  // Requires Supabase Storage setup
      }}

      // Display options
      display={{
        defaultOpen: false,      // Start with chat open
        size: 'default',         // 'compact' | 'default' | 'large' | 'full'
        resizable: true,         // Allow resizing
        showToggleButton: true,  // Show FAB toggle button
      }}

      // Starter prompts shown on empty chat
      starterPrompts={[
        { title: "What can you help me with?" },
        { title: "How do I get started?" },
      ]}
    />
  );
}
```

---

## File Uploads (Optional)

To enable image attachments, you need Supabase Storage and to enable the feature:

```tsx
<ChatWidget
  userId="user-123"
  features={{ fileUpload: true }}
/>
```

### 1. Create Storage Bucket

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Navigate to **Storage** → **New Bucket**
3. Create a bucket named `chat-attachments`
4. Set it to **Public** (or configure RLS policies for private access)

### 2. Add Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

You can find these in Supabase Dashboard → **Settings** → **API**

### 3. Create Upload Route

When running `npx @mordn/chat-widget`, select **Yes** when asked about the upload route.

---

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `userId` | `string` | **required** | User identifier for storing conversations |
| `conversationId` | `string` | - | Load a specific conversation |
| `initialMessages` | `array` | - | Pre-fill the chat with messages |
| `className` | `string` | - | Additional CSS classes |
| `theme` | `ThemeConfig` | - | Theme configuration |
| `features` | `FeatureConfig` | - | Feature toggles |
| `display` | `DisplayConfig` | - | Display options |

### ThemeConfig

```typescript
{
  mode?: 'light' | 'dark';
}
```

### FeatureConfig

```typescript
{
  fileUpload?: boolean;  // Enable file attachments (default: false)
  webSearch?: boolean;   // Enable web search toggle
}
```

### DisplayConfig

```typescript
{
  width?: string;              // e.g., '400px' or '30vw'
  defaultOpen?: boolean;       // Start with chat open (default: false)
  showToggleButton?: boolean;  // Show FAB toggle button (default: true)
  toggleButtonPosition?: {
    bottom?: string;
    right?: string;
  };
}
```

---

## Exports

```typescript
// Main component
import { ChatWidget } from '@mordn/chat-widget';
import '@mordn/chat-widget/styles.css';

// Database utilities (server-side only)
import {
  db,
  conversations,
  messages,
  createChat,
  loadChat,
  saveChat,
  getConversations,
  deleteConversation,
  updateConversationTitle,
  eq, and, or, desc, asc, sql
} from '@mordn/chat-widget/api';
```

---

## Generated Files Reference

<details>
<summary><strong>app/api/chat/route.ts</strong> - Main Chat Endpoint</summary>

```typescript
import { saveChat, updateConversationTitle, db, conversations, messages, eq } from '@mordn/chat-widget/api';
import { convertToModelMessages, streamText, UIMessage } from 'ai';

export const maxDuration = 30;

const DEVELOPER_CONFIG = {
  model: 'openai/gpt-4o',
  systemPrompt: 'You are a helpful assistant',
  temperature: 0.7,
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userId = req.headers.get('X-User-Id');

    if (!userId) {
      return new Response('userId is required in X-User-Id header', { status: 400 });
    }

    const chatMessages: UIMessage[] = body.messages || [];
    const id: string = body.id || 'temp-id';
    const { model, systemPrompt, temperature } = DEVELOPER_CONFIG;

    const existingConv = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);

    if (!existingConv.length) {
      await db.insert(conversations).values({
        id,
        userId,
        title: 'New Chat',
        metadata: {},
      });
    }

    const userMessages = chatMessages.filter(msg => msg.role === 'user');
    if (userMessages.length > 0) {
      const newUserMessage = userMessages[userMessages.length - 1];
      const textPart = newUserMessage.parts?.find(p => p.type === 'text') as { text: string } | undefined;
      const fileParts = newUserMessage.parts?.filter(p => p.type === 'file') || [];

      const existingMsg = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.id, newUserMessage.id))
        .limit(1);

      if (!existingMsg.length) {
        await db.insert(messages).values({
          id: newUserMessage.id,
          conversationId: id,
          role: newUserMessage.role,
          content: textPart?.text || '',
          files: fileParts,
          model: model,
          metadata: { parts: newUserMessage.parts || [] },
        });
      }

      if (textPart?.text) {
        const conv = await db
          .select({ title: conversations.title })
          .from(conversations)
          .where(eq(conversations.id, id))
          .limit(1);

        if (conv[0]?.title === 'New Chat') {
          await updateConversationTitle(id, textPart.text.slice(0, 100));
        }
      }
    }

    const transformedMessages = chatMessages.map(msg => {
      if (msg.role === 'user' && msg.parts) {
        const textPart = msg.parts.find(p => p.type === 'text');
        const fileParts = msg.parts.filter(p => p.type === 'file');

        if (fileParts.length > 0) {
          const content: any[] = [];
          if (textPart && 'text' in textPart) {
            content.push({ type: 'text', text: textPart.text });
          }
          for (const file of fileParts) {
            if ('mediaType' in file && (file as any).mediaType?.startsWith('image/')) {
              content.push({ type: 'image', image: (file as any).url });
            }
          }
          return { ...msg, content };
        }
      }
      return msg;
    });

    const result = streamText({
      model: model,
      messages: convertToModelMessages(transformedMessages),
      system: systemPrompt,
      temperature: temperature,
    });

    return result.toUIMessageStreamResponse({
      sendSources: true,
      sendReasoning: true,
      onFinish: ({ messages: finalMessages }) => {
        if (finalMessages.length > 0) {
          saveChat({ chatId: id, messages: finalMessages, model, userId });
        }
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

</details>

<details>
<summary><strong>app/api/chat/history/route.ts</strong> - List Conversations</summary>

```typescript
import { NextResponse } from 'next/server';
import { getConversations } from '@mordn/chat-widget/api';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') || request.headers.get('X-User-Id');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const conversationsData = await getConversations(userId);

    const conversations = conversationsData.map(conv => ({
      id: conv.id,
      title: conv.title,
      created_at: conv.createdAt,
      updated_at: conv.updatedAt,
      metadata: conv.metadata,
      message_count: conv.messageCount,
    }));

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('Error in chat history API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

</details>

<details>
<summary><strong>app/api/chat/history/[conversationId]/route.ts</strong> - Get Conversation</summary>

```typescript
import { NextResponse } from 'next/server';
import { db, conversations, messages, eq, and, asc } from '@mordn/chat-widget/api';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await params;
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') || request.headers.get('X-User-Id');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const conv = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        metadata: conversations.metadata,
      })
      .from(conversations)
      .where(and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId)
      ))
      .limit(1);

    if (!conv.length) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const conversation = conv[0];

    const dbMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .limit(1000);

    const transformedMessages = dbMessages.map(msg => {
      const metadata = msg.metadata as { parts?: any[] } | null;

      if (metadata?.parts && Array.isArray(metadata.parts)) {
        return {
          id: msg.id,
          role: msg.role,
          content: msg.content,
          created_at: msg.createdAt,
          parts: metadata.parts
        };
      }

      return {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        created_at: msg.createdAt,
        parts: msg.content ? [{ type: 'text', text: msg.content }] : undefined
      };
    });

    return NextResponse.json({ conversation, messages: transformedMessages });
  } catch (error) {
    console.error('Error loading conversation:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

</details>

<details>
<summary><strong>app/api/chat/upload/route.ts</strong> - File Upload (Optional)</summary>

```typescript
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Check for required environment variables
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      return Response.json({
        error: 'File upload is not configured. Please set up Supabase Storage environment variables.'
      }, { status: 503 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const conversationId = formData.get('conversationId') as string;
    const userId = formData.get('userId') as string;

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!userId) {
      return Response.json({ error: 'userId is required' }, { status: 400 });
    }

    if (!file.type.startsWith('image/')) {
      return Response.json({ error: 'Only image files are supported' }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ error: 'File size exceeds 5MB limit' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const timestamp = Date.now();
    const randomId = nanoid(8);
    const safeFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `${userId}/${conversationId || 'default'}/${timestamp}-${randomId}-${safeFilename}`;

    const fileBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from('chat-attachments')
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return Response.json({ error: 'Failed to upload file' }, { status: 500 });
    }

    const { data: urlData } = supabase.storage
      .from('chat-attachments')
      .getPublicUrl(filePath);

    return Response.json({
      url: urlData.publicUrl,
      filename: file.name,
      mediaType: file.type,
      size: file.size,
      type: 'file',
    });
  } catch (error) {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

</details>

---

## License

MIT
