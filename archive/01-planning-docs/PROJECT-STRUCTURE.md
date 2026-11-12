# SureVax CMS v2.0 - Project Structure

**Last Updated**: March 14, 2026

---

## 📂 Current Directory Structure

```
surevax-cms-revamp/
│
├── 📖 README.md                       # Project overview & navigation
│
├── ⭐ QUICK-START.md                  # START HERE - Quick reference
├── ⭐ TECH-STACK-ROADMAP.md           # MAIN GUIDE - Complete roadmap
├── 📂 PROJECT-STRUCTURE.md            # This file - Navigation guide
│
├── 📊 database-schema-v4.md           # Current database design
├── 👥 USER-STORIES.md                 # User requirements
├── 🎨 UI-DESIGN-GUIDE.md              # Design system
│
├── 📝 TODO.md                         # Current tasks
├── 💡 FUTURE-IMPROVEMENTS.md          # Future plans
│
├── 📁 docs/                           # Documentation
│   └── policies/                      # Policies & strategies
│       ├── DEPENDENCY-POLICY.md       # Dependency management
│       └── DEPLOYMENT-STRATEGY.md     # Infrastructure guide
│
├── 📁 .cursor/                        # Cursor AI configuration
│   └── rules/                         # AI rules
│       └── project-guidelines.mdc    # Project rules for AI
│       └── surevax-cms-v2/
│           └── requirements.md
│
├── 📁 references/                     # Research materials
│   ├── Project Proposal_ SureVax CMS (v2.0).md
│   ├── Project Proposal_ SureVax CMS (v2.0) Milestones.md
│   ├── Clinic Workflow Case Study Research.md
│   ├── Data Dictionary _ Schema.md
│   ├── EMR Multi-Tenancy Database Design.md
│   └── Philippine Health Data Compliance Research.md
│
└── 📁 archive/                        # Historical documents
    ├── README.md                      # Archive guide
    ├── decisions/                     # Past decisions
    ├── tech-stack-iterations/         # Previous versions
    ├── documentation/                 # Old schema docs
    └── schemas/                       # Previous schemas
```

---

## 📚 Document Categories

### 🎯 Essential (Read First)

| Document                  | Purpose          | When to Read  |
| ------------------------- | ---------------- | ------------- |
| **README.md**             | Project overview | First thing   |
| **QUICK-START.md**        | Quick reference  | When starting |
| **TECH-STACK-ROADMAP.md** | Complete guide   | Before coding |

### 📋 Planning & Design

| Document                  | Purpose         | When to Read         |
| ------------------------- | --------------- | -------------------- |
| **database-schema-v4.md** | Database design | Before backend work  |
| **USER-STORIES.md**       | Requirements    | Before any feature   |
| **UI-DESIGN-GUIDE.md**    | Design system   | Before frontend work |

### 🔧 Policies & Strategies

| Document                                 | Purpose          | When to Read       |
| ---------------------------------------- | ---------------- | ------------------ |
| **docs/policies/DEPENDENCY-POLICY.md**   | Adding libraries | Before npm install |
| **docs/policies/DEPLOYMENT-STRATEGY.md** | Infrastructure   | Before deployment  |

### 📝 Project Management

| Document                   | Purpose       | When to Read      |
| -------------------------- | ------------- | ----------------- |
| **TODO.md**                | Current tasks | Daily             |
| **FUTURE-IMPROVEMENTS.md** | Future plans  | Planning sessions |

---

## 🗺️ Reading Order

### For Developers (New to Project)

1. **README.md** - Get oriented (5 min)
2. **QUICK-START.md** - Understand the stack (10 min)
3. **TECH-STACK-ROADMAP.md** - Deep dive (30 min)
4. **USER-STORIES.md** - Understand requirements (15 min)
5. **database-schema-v4.md** - Study data model (20 min)
6. Start coding!

**Total**: ~1.5 hours to full context

### For Stakeholders (Non-Technical)

1. **README.md** - Project overview
2. **USER-STORIES.md** - Features and workflows
3. **TECH-STACK-ROADMAP.md** - Phase 1 & 2 sections
4. **DEPLOYMENT-STRATEGY.md** - Cost analysis

### For AI Assistants (Like Me)

1. **.cursor/rules/project-guidelines.mdc** - Project rules
2. **TECH-STACK-ROADMAP.md** - Architecture patterns
3. **database-schema-v4.md** - Data model
4. **USER-STORIES.md** - Business logic
5. **docs/policies/DEPENDENCY-POLICY.md** - Constraints

---

## 📊 Document Status

### ✅ Complete & Current

- README.md
- QUICK-START.md
- TECH-STACK-ROADMAP.md
- PROJECT-STRUCTURE.md
- database-schema-v4.md
- USER-STORIES.md
- UI-DESIGN-GUIDE.md
- docs/policies/DEPENDENCY-POLICY.md
- docs/policies/DEPLOYMENT-STRATEGY.md

### 🚧 Living Documents (Updated Regularly)

- TODO.md
- FUTURE-IMPROVEMENTS.md

### 📦 Archived (Reference Only)

- archive/decisions/
- archive/tech-stack-iterations/
- archive/schemas/

---

## 🔍 Quick Find

### "I want to..."

**...get started quickly**
→ `QUICK-START.md`

**...understand the architecture**
→ `TECH-STACK-ROADMAP.md`

**...see the database design**
→ `database-schema-v4.md`

**...know what features to build**
→ `USER-STORIES.md`

**...add a new dependency**
→ `docs/policies/DEPENDENCY-POLICY.md`

**...deploy the application**
→ `docs/policies/DEPLOYMENT-STRATEGY.md`

**...design a UI component**
→ `UI-DESIGN-GUIDE.md`

**...see what's next**
→ `TODO.md` or `FUTURE-IMPROVEMENTS.md`

**...understand past decisions**
→ `archive/decisions/`

---

## 📏 Document Standards

### File Naming

- UPPERCASE-WITH-DASHES.md for root docs
- lowercase-with-dashes.md for subdirectories
- Descriptive names (not doc1.md, doc2.md)

### Content Structure

- Title at top
- Last updated date
- Table of contents for long docs
- Clear sections with headers
- Code examples where relevant
- Links to related docs

### Maintenance

- Update "Last Updated" date when editing
- Archive superseded versions
- Keep README.md current
- Review quarterly

---

## 🎯 Key Principles

1. **Single Source of Truth** - One current version per topic
2. **Clear Navigation** - Easy to find what you need
3. **Context Preservation** - Archive old versions, don't delete
4. **Living Documentation** - Update as project evolves
5. **AI-Friendly** - Structured for AI assistance

---

## 📞 Need Help?

**Can't find something?**

- Check README.md first
- Look in archive/ for historical docs
- Search for keywords in all .md files

**Document outdated?**

- Check "Last Updated" date
- Look for newer version in root
- Check archive/ for superseded versions

**Want to add documentation?**

- Follow naming conventions
- Update README.md with link
- Add to appropriate category

---

**Remember**: Documentation is code. Keep it clean, organized, and up-to-date.
