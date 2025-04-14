# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Run Commands
- Start server: `npm start`
- Development mode with auto-reload: `npm run dev`
- Run tests: `npm test`
- Run a single test: `npm test -- -t "test name"`
- Post-install setup: `npm run postinstall`

## Code Style Guidelines
- Indentation: 2 spaces
- Quotes: Single quotes for strings
- Semicolons: Required
- Naming: camelCase for variables/functions, PascalCase for classes
- Module pattern: IIFE for frontend code
- Error handling: Use try/catch blocks with specific error messages
- Comments: Document functions with JSDoc-style comments
- File structure: Separate concerns between routes, middleware, and business logic
- Internationalization: Use i18next for all user-facing text
- Defensive programming: Validate inputs, use fallbacks, check for null/undefined

## Security Practices
- Use helmet.js for secure HTTP headers
- Implement proper CSRF protection
- Sanitize user inputs before processing
- Use HttpOnly cookies with proper security attributes
- Implement rate limiting for API endpoints