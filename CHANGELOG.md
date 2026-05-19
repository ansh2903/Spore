# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Documentation suite: `CLAUDE.md`, `AGENTS.md`, `DESIGN.md`, `CONTRIBUTING.md`, and `docs/` guides
- `.env.example` for local configuration
- Vendor icons under frontend static path

### Fixed

- Static asset path now points to `frontend/src/templates/pages/static/`
- Docker entrypoint uses `python -m spore._app` with repo-root build context
- LLM settings JSON resolves to `spore/_config/settings.json`
- Added `uuid_extensions` to `requirements.txt`
