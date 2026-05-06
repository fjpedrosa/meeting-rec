# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| Building UI components, managing state, optimizing frontend performance, accessibility | frontend-development | ~/.claude/skills/frontend-development/SKILL.md |
| Designing RESTful APIs, defining microservice boundaries, planning database schemas, scalability | backend-architecture | ~/.claude/skills/backend-architecture/SKILL.md |
| Building iOS apps, UIKit/SwiftUI components, Core Data integration | ios-development | ~/.claude/skills/ios-development/SKILL.md |
| Optimizing JS, debugging async issues, implementing complex JS patterns | javascript-mastery | ~/.claude/skills/javascript-mastery/SKILL.md |
| Database design decisions, data modeling, scalability planning | database-architecture | ~/.claude/skills/database-architecture/SKILL.md |
| Fixing slow queries, designing indexes, resolving N+1 problems, execution plans | database-optimization | ~/.claude/skills/database-optimization/SKILL.md |
| Building LLM integrations, RAG pipelines, prompt engineering, vector search | ai-engineering | ~/.claude/skills/ai-engineering/SKILL.md |
| Designing infrastructure, writing Terraform/IaC, optimizing costs | cloud-infrastructure | ~/.claude/skills/cloud-infrastructure/SKILL.md |
| Setting up projects, reducing friction, improving development workflows | developer-experience | ~/.claude/skills/developer-experience/SKILL.md |
| Cross-platform mobile development with React Native and Flutter | mobile-development | ~/.claude/skills/mobile-development/SKILL.md |
| KPI tracking, revenue analysis, growth projections, cohort analysis | business-analysis | ~/.claude/skills/business-analysis/SKILL.md |
| Blog posts, social media content, email campaigns, SEO strategy | content-marketing | ~/.claude/skills/content-marketing/SKILL.md |
| Product positioning, market analysis, feature prioritization | product-strategy | ~/.claude/skills/product-strategy/SKILL.md |
| Cold email campaigns, follow-up sequences, proposal templates | sales-automation | ~/.claude/skills/sales-automation/SKILL.md |
| Privacy policies, terms of service, GDPR compliance | legal-compliance | ~/.claude/skills/legal-compliance/SKILL.md |
| Campaign tracking, attribution modeling, conversion optimization | marketing-attribution | ~/.claude/skills/marketing-attribution/SKILL.md |
| Deep research, information gathering, trend analysis | web-research | ~/.claude/skills/web-research/SKILL.md |
| Technical documentation, code repositories, implementation details | technical-research | ~/.claude/skills/technical-research/SKILL.md |
| Debugging issues, analyzing logs, investigating production errors | error-analysis | ~/.claude/skills/error-analysis/SKILL.md |
| Complex projects, session coordination, context preservation | context-management | ~/.claude/skills/context-management/SKILL.md |
| Multi-step projects requiring different capabilities | task-decomposition | ~/.claude/skills/task-decomposition/SKILL.md |
| ETL/ELT pipelines, designing data warehouses, streaming architectures | data-engineering | ~/.claude/skills/data-engineering/SKILL.md |
| Exploratory data analysis, statistical modeling, ML experiments | data-science | ~/.claude/skills/data-science/SKILL.md |
| Automated exploratory UI testing loop | auto-explore | ~/.claude/skills/auto-explore/SKILL.md |
| Designing software systems, reviewing code structure, refactoring applications | clean-architecture | ~/.agents/skills/clean-architecture/SKILL.md |
| Creating or modifying project structure following screaming architecture | screaming-architecture | ~/.agents/skills/screaming-architecture/SKILL.md |
| Vertical slice architecture, VSA, feature-based architecture | vertical-slice-architecture | ~/.agents/skills/vertical-slice-architecture/SKILL.md |
| REST, GraphQL, gRPC, versioning, authentication, API best practices | api-design-patterns | ~/.agents/skills/api-design-patterns/SKILL.md |
| Adding authentication, handling user input, secrets, API endpoints, payment features | security-review | ~/.agents/skills/security-review/SKILL.md |
| Writing JavaScript/TypeScript tests, setting up test infrastructure, TDD/BDD | javascript-testing-patterns | ~/.agents/skills/javascript-testing-patterns/SKILL.md |
| Implementing complex type logic, creating reusable type utilities, compile-time safety | typescript-advanced-types | ~/.agents/skills/typescript-advanced-types/SKILL.md |
| shadcn/ui components, React Hook Form, Zod, Tailwind CSS theming | shadcn-ui | ~/.agents/skills/shadcn-ui/SKILL.md |
| Building design systems with Tailwind CSS v4, design tokens | tailwind-design-system | ~/.config/opencode/skills/tailwind-design-system/SKILL.md |
| Three.js animation, skeletal animation, morph targets | threejs-animation | ~/.config/opencode/skills/threejs-animation/SKILL.md |
| Review UI code for Web Interface Guidelines compliance | web-design-guidelines | ~/.config/opencode/skills/web-design-guidelines/SKILL.md |
| UI/UX design intelligence, 50 styles, 21 palettes | ui-ux-pro-max | ~/.config/opencode/skills/ui-ux-pro-max/SKILL.md |
| Docusaurus documentation sites, content management, theming | docusaurus | ~/.claude/skills/docusaurus/SKILL.md |
| Drizzle ORM, type-safe SQL for TypeScript | drizzle-orm | ~/.claude/skills/drizzle-orm/SKILL.md |
| Stripe, PayPal, checkout flows, subscription billing | payment-systems | ~/.claude/skills/payment-systems/SKILL.md |
| Coordinating complex research tasks across specialist researchers | research-coordination | ~/.claude/skills/research-coordination/SKILL.md |
| Managing comprehensive research projects, Open Deep Research | research-orchestration | ~/.claude/skills/research-orchestration/SKILL.md |
| Scraping web content with Scrapy framework | scrapy-web-scraping | ~/.agents/skills/scrapy-web-scraping/SKILL.md |
| Scraping URLs with bot detection, Bright Data | brightdata | ~/.agents/skills/brightdata/SKILL.md |
| Next.js 16 features, migration from v15 | nextjs-16-complete-guide | ~/.config/opencode/skills/nextjs-16-complete-guide/SKILL.md |
| Remotion video creation in React | remotion-best-practices | ~/.agents/skills/remotion-best-practices/SKILL.md |
| Postgres optimization from Supabase | supabase-postgres-best-practices | ~/.agents/skills/supabase-postgres-best-practices/SKILL.md |
| Migration-first database development with Drizzle ORM | drizzle-migrations | ~/.agents/skills/drizzle-migrations/SKILL.md |
| Discovering and installing agent skills | find-skills | ~/.agents/skills/find-skills/SKILL.md |
| Parallel adversarial review protocol | judgment-day | ~/.config/opencode/skills/judgment-day/SKILL.md |
| Creating new AI agent skills | skill-creator | ~/.config/opencode/skills/skill-creator/SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### frontend-development
- Component-first thinking — reusable, composable UI pieces
- Mobile-first responsive design
- Performance budgets — aim for sub-3s load times
- Semantic HTML and proper ARIA attributes
- Type safety with TypeScript interfaces for all props
- Include basic unit test structure for components

### backend-architecture
- Design APIs contract-first with clear service boundaries
- Consider data consistency requirements before choosing patterns
- Plan for horizontal scaling from day one, but start simple
- Include example requests/responses for all endpoints
- Document potential bottlenecks and scaling considerations

### ios-development
- SwiftUI-first with UIKit integration only when needed
- Protocol-oriented programming patterns
- Async/await for modern concurrency (no completion handlers)
- MVVM architecture with observable patterns
- Follow Apple Human Interface Guidelines and include accessibility support

### javascript-mastery
- Prefer async/await over promise chains
- Handle errors at appropriate boundaries, not globally
- Use functional patterns where appropriate
- Consider bundle size for browser code
- Support both Node.js and browser environments with JSDoc comments

### database-architecture
- Align database structure with business domains (DDD)
- Choose consistency models based on actual needs, not defaults
- Plan for growth from day one, but start simple
- Prefer managed services and standard patterns for operational simplicity

### database-optimization
- Measure first with EXPLAIN ANALYZE before optimizing
- Index strategically based on query patterns, not assumptions
- Denormalize only when justified by read patterns
- Monitor slow query logs and key metrics continuously
- Include migration scripts with rollback procedures

### ai-engineering
- Start with simple prompts, iterate based on outputs
- Implement fallbacks for AI service failures
- Monitor token usage and costs
- Use structured outputs (JSON mode, function calling)
- Test with edge cases and adversarial inputs

### clean-architecture
- Source dependencies point inward only (dep-inward-only)
- Interfaces belong to clients not implementers (dep-interface-ownership)
- Entities contain only enterprise business rules — no persistence awareness
- Use simple data structures across boundaries
- Eliminate cyclic dependencies between components
- Build rich domain models, not anemic data structures

### screaming-architecture
- Organize by domain: `src/{feature}/application/`, `domain/`, `infrastructure/`, `presentation/`, `dto/`
- Use cases in `application/`, entities in `domain/`, repos (interface) in `domain/`, impl in `infrastructure/`
- Feature name should scream the business capability

### vertical-slice-architecture
- One feature = one directory containing handler, types, validation, tests
- One entry point per feature — setup/registration function receives router + dependencies
- Minimize coupling between slices, maximize coupling within a slice
- No premature abstractions — no shared repo/service layers until genuine duplication across slices
- Test each feature through its entry point, verifying outcomes

### api-design-patterns
- REST for resource-based CRUD, GraphQL for complex data graphs, gRPC for high-performance RPC
- Versioning: prefer URI `/v1/` for simplicity or header-based for flexibility
- Pagination: cursor-based for stable results, offset for simple cases
- Always implement idempotency keys for non-idempotent operations
- Rate limiting with token bucket or sliding window

### security-review
- NEVER hardcode API keys, tokens, or passwords — use environment variables
- Validate and sanitize ALL user input on the server side
- Use parameterized queries to prevent SQL injection
- Implement CORS with explicit allowed origins
- Store passwords with bcrypt/argon2, never plain text or MD5/SHA
- Validate file uploads: type, size, and content

### javascript-testing-patterns
- Use `describe`/`it` blocks with clear naming: "should [expected behavior] when [condition]"
- Prefer `bun:test` for this project (Bun runtime)
- Mock external dependencies at module boundaries, not internal functions
- Test behavior, not implementation — assert outcomes not method calls
- Co-locate test files with source: `*.test.ts` alongside `*.ts`

### typescript-advanced-types
- Use generics with constraints (`T extends HasLength`) over `any`
- Prefer `unknown` over `any` for type-safe narrowing
- Use discriminated unions for state machines and variant types
- Leverage template literal types for string patterns
- Use `satisfies` operator for type validation without widening

### shadcn-ui
- Install components via CLI: `npx shadcn@latest add [component]`
- Components are copied into your project — customize freely
- Use React Hook Form + Zod for form validation
- Follow the compound component pattern for complex components

### tailwind-design-system
- Use Tailwind CSS v4 with design tokens for consistency
- Define color palette, spacing, and typography scales in config
- Build component variants with `class-variance-authority` (cva)

### web-design-guidelines
- Progressive disclosure — show essential info first, details on demand
- Provide clear visual hierarchy with consistent spacing
- Ensure WCAG 2.1 AA compliance for all interactive elements

### ui-ux-pro-max
- Match UI style to project intent (glassmorphism, minimalism, etc.)
- Use consistent font pairings and color palettes
- Responsive-first with proper breakpoint handling

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| CLAUDE.md | /Users/javi/projects/experimento/CLAUDE.md | Bun-first conventions — use Bun APIs, `bun test`, `Bun.serve()`, HTML imports |
| .cursorrules | /Users/javi/projects/experimento/.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc | Same Bun-first rules for Cursor |

Read the convention files listed above for project-specific patterns and rules. All referenced paths have been extracted — no need to read index files to discover more.
