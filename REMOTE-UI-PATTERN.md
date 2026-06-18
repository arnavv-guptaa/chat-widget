# Remote UI Loading Pattern (CDN-Loaded Components)

> **Note**: This document describes an architecture pattern used by Clerk, Stripe, Intercom, and others for shipping embeddable UI components. Consider this approach for the chat widget.

## How It Works

Instead of shipping all UI code in the npm package, you ship a **thin loader** that fetches the actual UI from your CDN at runtime.

```
User installs: npm install @parallax/chat-widget (tiny ~5KB loader)
                            ↓
At runtime: Loader fetches real UI from CDN (~100-200KB)
                            ↓
CDN script renders the actual chat widget
```

## Architecture

### What ships in npm package (node_modules)
- Thin React wrapper component
- TypeScript types
- Configuration utilities
- Script loader function

### What lives on your CDN
- Actual UI components (buttons, chat bubbles, forms)
- All CSS/styles
- Business logic
- Animations

## Implementation Example

### The npm package exports a shell component:

```tsx
// src/ChatWidget.tsx (ships in npm)
import { useEffect, useRef } from 'react';

export function ChatWidget({ apiKey, theme }: ChatWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load the actual UI from CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.parallax.com/chat-widget/v1/widget.js';
    script.async = true;
    script.onload = () => {
      // CDN script exposes a global init function
      window.ParallaxChat.mount(containerRef.current, { apiKey, theme });
    };
    document.head.appendChild(script);

    return () => {
      window.ParallaxChat?.unmount(containerRef.current);
    };
  }, [apiKey, theme]);

  // Just renders an empty container - CDN script fills it
  return <div ref={containerRef} />;
}
```

### The CDN hosts the actual UI:

```javascript
// https://cdn.parallax.com/chat-widget/v1/widget.js
(function() {
  window.ParallaxChat = {
    mount(container, config) {
      // Render actual chat UI into container
      // All styles, components, logic lives HERE
    },
    unmount(container) {
      // Cleanup
    }
  };
})();
```

## Benefits

| Benefit | Impact |
|---------|--------|
| **Instant updates** | Fix bugs, update UI without users running npm update |
| **Smaller user bundles** | Users ship 5KB loader instead of 200KB widget |
| **Version control** | Serve different versions, A/B test, gradual rollouts |
| **Consistent experience** | All users get same tested, polished UI |
| **Analytics built-in** | Track widget loads, interactions from your CDN |
| **Security** | Sensitive logic stays on your servers |

## Tradeoffs

| Tradeoff | Consideration |
|----------|---------------|
| **CDN dependency** | Widget won't work if CDN is down |
| **Network latency** | Extra request on page load |
| **Less customization** | Users can't modify internal HTML/CSS |
| **Versioning complexity** | Need to manage CDN versions carefully |

## Companies Using This Pattern

- **Clerk** - Authentication UI (SignIn, SignUp, UserButton)
- **Stripe** - Payment Elements (card inputs, checkout)
- **Intercom** - Chat widget
- **Auth0** - Lock (login modal)
- **HubSpot** - Forms and chat
- **Typeform** - Embedded forms
- **YouTube/Vimeo** - Video embeds

## Implementation Steps for Chat Widget

1. **Split the codebase**:
   - `npm-package/` - Thin loader, types, React wrapper
   - `cdn-bundle/` - Actual UI components, styles

2. **Set up CDN hosting** (CloudFlare, AWS CloudFront, Vercel Edge)

3. **Build pipeline**:
   - npm package → publishes to npm registry
   - CDN bundle → deploys to CDN with versioning

4. **Versioning strategy**:
   ```
   https://cdn.parallax.com/chat-widget/v1/widget.js  (stable)
   https://cdn.parallax.com/chat-widget/v2/widget.js  (next major)
   https://cdn.parallax.com/chat-widget/latest/widget.js (bleeding edge)
   ```

5. **Fallback handling**:
   ```tsx
   script.onerror = () => {
     console.error('Failed to load chat widget');
     // Show fallback UI or retry
   };
   ```

---

## API Architecture (How Clerk Handles It)

The remote UI doesn't just load components - it also makes **direct API calls** from the browser to Clerk's servers, bypassing the host app entirely.

### Request Flow

```
User's Browser                          Clerk Infrastructure
──────────────                          ────────────────────

┌──────────────────────┐
│  Your App            │
│  ┌────────────────┐  │
│  │ Clerk <SignIn/>│  │
│  │ (from CDN)     │  │
│  │                │  │     POST https://api.clerk.com/v1/sign_ins
│  │  [Submit Btn]──┼──┼─────────────────────────────────────────►
│  │                │  │                                          │
│  │                │◄─┼──────────────────────────────────────────┘
│  └────────────────┘  │     { session_token, user }
└──────────────────────┘
```

**Key point**: The host app's server is never involved in auth requests. Browser talks directly to Clerk's API.

### Security Model (Three Layers)

#### Layer 1: Publishable Key (Public)

```javascript
// Sent with every browser request
headers: {
  'Authorization': 'Bearer pk_live_abc123...'
}
```

- This key is **public** - visible in page source
- Identifies which Clerk account/app the request is for
- Not secret, not enough for security alone

#### Layer 2: Domain Allowlist

In Clerk Dashboard, you configure allowed domains:

```
Allowed Origins:
✓ https://yourapp.com
✓ https://www.yourapp.com
✓ http://localhost:3000
```

Clerk's server validates the `Origin` header:

```javascript
// Clerk's API server (simplified)
if (!allowedDomains.includes(request.headers.origin)) {
  return Response(403, 'Domain not allowed');
}
```

Even if someone steals your publishable key, they can't use it from a different domain.

#### Layer 3: Secret Key (Server-Only)

```bash
CLERK_SECRET_KEY=sk_live_xyz789...  # NEVER sent to browser
```

Used only for:
- Server-side token verification (middleware)
- Admin API operations
- Server-to-server calls

### Attack Scenarios & Protections

| Attack | Protection |
|--------|------------|
| Steal publishable key, use from evil-site.com | Domain allowlist blocks it |
| Spoof Origin header from browser | Browsers enforce CORS, can't spoof |
| Spoof Origin via curl/Postman | Can only create accounts in YOUR instance (useless) |
| Steal secret key | Game over - that's why it stays server-side only |

### For Chat Widget Implementation

Apply the same model:

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR INFRASTRUCTURE                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   CDN (UI)                         API Server                │
│   ────────                         ──────────                │
│   chat-widget.js                   api.parallax.com          │
│                                                              │
│        │                                 ▲                   │
│        │ loads                           │                   │
│        ▼                                 │                   │
│   ┌─────────┐     POST /message          │                   │
│   │ Widget  │────────────────────────────┘                   │
│   │   UI    │                                                │
│   └─────────┘                                                │
│        ▲                                                     │
│        │ embedded in                                         │
│        │                                                     │
└────────┼─────────────────────────────────────────────────────┘
         │
    Customer's Website
    (yourwidget.com)
```

#### Keys for Chat Widget

```javascript
// Customer adds to their site (PUBLIC)
<script>
  ParallaxChat.init({
    publishableKey: 'pk_live_customer123...',  // Safe to expose
    // ... other config
  });
</script>
```

```bash
# Customer's server uses for admin ops (SECRET)
PARALLAX_CHAT_SECRET_KEY=sk_live_xyz...
```

#### API Security Implementation

```javascript
// Your API server (api.parallax.com)
app.post('/api/chat/message', (req, res) => {
  const publishableKey = req.headers['x-api-key'];
  const origin = req.headers['origin'];

  // 1. Validate publishable key exists
  const customer = await db.getCustomerByPublishableKey(publishableKey);
  if (!customer) return res.status(401).json({ error: 'Invalid API key' });

  // 2. Validate origin is in customer's allowlist
  if (!customer.allowedDomains.includes(origin)) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  // 3. Process the message
  const response = await processMessage(req.body);
  return res.json(response);
});
```

#### Database Schema for Multi-Tenant

```sql
-- Customers table
CREATE TABLE customers (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  publishable_key VARCHAR(255) UNIQUE,  -- pk_live_xxx
  secret_key VARCHAR(255) UNIQUE,        -- sk_live_xxx (hashed)
  allowed_domains TEXT[],                -- ['https://customer.com']
  created_at TIMESTAMP
);

-- Chat messages (scoped to customer)
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers(id),
  session_id VARCHAR(255),
  content TEXT,
  role VARCHAR(50),  -- 'user' or 'assistant'
  created_at TIMESTAMP
);
```

#### Key Generation

```javascript
// Generate keys for new customer
import crypto from 'crypto';

function generateKeyPair(customerId) {
  const random = crypto.randomBytes(24).toString('base64url');
  return {
    publishableKey: `pk_live_${random}`,
    secretKey: `sk_live_${crypto.randomBytes(32).toString('base64url')}`
  };
}
```

### Summary: What Lives Where

| Component | Location | Security Level |
|-----------|----------|----------------|
| Widget UI (JS/CSS) | Your CDN | Public |
| Publishable Key | Customer's frontend | Public (domain-restricted) |
| Secret Key | Customer's server | Secret |
| Chat API | Your API server | Protected by key + domain |
| Customer Data | Your database | Isolated per customer |

---

## Resources

- Clerk's implementation: Look at `@clerk/clerk-js` source
- Stripe Elements docs: https://stripe.com/docs/js
- Module Federation (webpack): Alternative approach for micro-frontends

---

*Added: December 2024*
*Context: Discovered while implementing Clerk auth in Jarvis project*
