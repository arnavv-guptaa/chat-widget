import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase());
    });
  });
}

async function confirm(message: string): Promise<boolean> {
  const answer = await ask(`${message} (y/n): `);
  return answer === 'y' || answer === 'yes';
}

function detectAppDir(): string {
  // Check for src/app first, then app
  if (fs.existsSync(path.join(process.cwd(), 'src', 'app'))) {
    return path.join(process.cwd(), 'src', 'app');
  }
  if (fs.existsSync(path.join(process.cwd(), 'app'))) {
    return path.join(process.cwd(), 'app');
  }
  // Default to src/app
  return path.join(process.cwd(), 'src', 'app');
}

async function writeFileWithConfirm(filePath: string, content: string): Promise<boolean> {
  if (fs.existsSync(filePath)) {
    const overwrite = await confirm(`File ${path.relative(process.cwd(), filePath)} already exists. Overwrite?`);
    if (!overwrite) {
      console.log(`  Skipped: ${path.relative(process.cwd(), filePath)}`);
      return false;
    }
  }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  console.log(`  Created: ${path.relative(process.cwd(), filePath)}`);
  return true;
}

// ============================================
// FILE TEMPLATES
// ============================================

const MAIN_ROUTE = `import { saveChat, updateConversationTitle, db, conversations, messages, eq } from '@mordn/chat-widget/api';
import { convertToModelMessages, streamText, UIMessage } from 'ai';

export const maxDuration = 30;

// ============================================
// DEVELOPER CONFIG - Set these for your app
// ============================================
const DEVELOPER_CONFIG = {
  model: 'openai/gpt-4o', // Your AI model (provider/model format)
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

    // Check if conversation exists, create if not
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

    // Save the new user message
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

      // Update conversation title if needed
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

    // Transform messages for AI (handle images)
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
`;

const HISTORY_ROUTE = `import { NextResponse } from 'next/server';
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
`;

const CONVERSATION_ROUTE = `import { NextResponse } from 'next/server';
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

    // Verify the conversation belongs to the user
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
`;

const UPLOAD_ROUTE = `import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Check for required environment variables
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
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

    // Only images supported
    if (!file.type.startsWith('image/')) {
      return Response.json({ error: 'Only image files are supported' }, { status: 400 });
    }

    // 5MB limit
    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ error: 'File size exceeds 5MB limit' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const timestamp = Date.now();
    const randomId = nanoid(8);
    const safeFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = \`\${userId}/\${conversationId || 'default'}/\${timestamp}-\${randomId}-\${safeFilename}\`;

    const fileBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from('chat-attachments')
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
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
    console.error('Upload API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
`;

const DRIZZLE_CONFIG = `import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './node_modules/@mordn/chat-widget/dist/schema/index.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
`;

const ENV_EXAMPLE = `# Database (Required)
DATABASE_URL="postgresql://postgres.xxx:[PASSWORD]@aws-0-region.pooler.supabase.com:6543/postgres"

# AI Gateway (Required)
AI_GATEWAY_API_KEY="your-ai-gateway-key"

# Supabase Storage (Optional - for file uploads)
NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
`;

// ============================================
// MAIN INIT FUNCTION
// ============================================

async function init() {
  console.log('\n@mordn/chat-widget init\n');
  console.log('This will create the required API routes and configuration files.\n');

  const appDir = detectAppDir();
  const apiChatDir = path.join(appDir, 'api', 'chat');

  console.log(`Detected app directory: ${path.relative(process.cwd(), appDir)}\n`);

  let filesCreated = 0;

  // Create main chat route
  console.log('Creating API routes...');
  if (await writeFileWithConfirm(path.join(apiChatDir, 'route.ts'), MAIN_ROUTE)) {
    filesCreated++;
  }

  // Create history route
  if (await writeFileWithConfirm(path.join(apiChatDir, 'history', 'route.ts'), HISTORY_ROUTE)) {
    filesCreated++;
  }

  // Create conversation route
  if (await writeFileWithConfirm(path.join(apiChatDir, 'history', '[conversationId]', 'route.ts'), CONVERSATION_ROUTE)) {
    filesCreated++;
  }

  // Ask about upload route
  const createUpload = await confirm('\nCreate file upload route? (requires Supabase Storage)');
  let uploadRouteCreated = false;
  if (createUpload) {
    if (await writeFileWithConfirm(path.join(apiChatDir, 'upload', 'route.ts'), UPLOAD_ROUTE)) {
      filesCreated++;
      uploadRouteCreated = true;
    }
  }

  // Create drizzle config
  console.log('\nCreating configuration files...');
  if (await writeFileWithConfirm(path.join(process.cwd(), 'drizzle.config.ts'), DRIZZLE_CONFIG)) {
    filesCreated++;
  }

  // Create .env.example
  if (await writeFileWithConfirm(path.join(process.cwd(), '.env.example'), ENV_EXAMPLE)) {
    filesCreated++;
  }

  console.log(`\n✓ Created ${filesCreated} files\n`);

  console.log('Next steps:');
  console.log('  1. Copy .env.example to .env.local and fill in your credentials');
  console.log('  2. Run: npx drizzle-kit push');
  if (uploadRouteCreated) {
    console.log('  3. Create a "chat-attachments" bucket in Supabase Storage');
    console.log('  4. Add the ChatWidget with file uploads enabled:\n');
    console.log("     import { ChatWidget } from '@mordn/chat-widget';");
    console.log("     import '@mordn/chat-widget/styles.css';");
    console.log('');
    console.log('     <ChatWidget userId="user-123" features={{ fileUpload: true }} />\n');
  } else {
    console.log('  3. Add the ChatWidget to your app:\n');
    console.log("     import { ChatWidget } from '@mordn/chat-widget';");
    console.log("     import '@mordn/chat-widget/styles.css';");
    console.log('');
    console.log('     <ChatWidget userId="user-123" />\n');
  }

  rl.close();
}

init().catch((error) => {
  console.error('Error:', error);
  rl.close();
  process.exit(1);
});
