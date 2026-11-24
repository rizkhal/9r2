#!/usr/bin/env bun
// Drops and recreates the public schema so a test run starts from an empty database.
import { SQL } from 'bun'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const sql = new SQL(url)
await sql.unsafe('drop schema if exists public cascade')
await sql.unsafe('create schema public')
// drizzle keeps its migration journal here; drop it too or re-migrating is a no-op.
await sql.unsafe('drop schema if exists drizzle cascade')
await sql.end()
console.log('schema reset')
