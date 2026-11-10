/*
 * Küchenrunde – Einladungen für den Familienhaushalt
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Die RPCs sind die einzige Schnittstelle. Tokens werden nur beim Erzeugen
 * einmalig zurückgegeben; in der Datenbank liegt ausschließlich ihr Hash.
 */

import { requireSupabase } from '../supabase/client'

export interface HouseholdInvite {
  id: string
  createdAt: string
  expiresAt: string
  redeemedAt: string | null
  revokedAt: string | null
}

export interface CreatedHouseholdInvite {
  token: string
  expiresAt: string
}

export type RedeemResult = 'joined' | 'already_member'

export class NotFamilyAdminError extends Error {
  constructor() {
    super('Nur Haushaltsadministratoren können Einladungen verwalten.')
    this.name = 'NotFamilyAdminError'
  }
}

export class InviteUnavailableError extends Error {
  constructor() {
    super(
      'Dieser Einladungslink ist abgelaufen, wurde widerrufen oder bereits eingelöst. Bitte den Administrator um einen neuen Link.',
    )
    this.name = 'InviteUnavailableError'
  }
}

function isPermissionError(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === '42501' ||
    /not a household admin|not authenticated/i.test(error?.message ?? '')
  )
}

function isInviteUnavailable(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === 'P0002' ||
    /invite invalid|expired|revoked|already used/i.test(error?.message ?? '')
  )
}

export async function isHouseholdAdmin(): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc('is_household_admin')
  if (error) {
    if (isPermissionError(error)) return false
    throw new Error('Der Administratorstatus konnte nicht geprüft werden.')
  }
  return data === true
}

export async function listHouseholdInvites(): Promise<HouseholdInvite[]> {
  const { data, error } = await requireSupabase().rpc('list_household_invites')
  if (error) {
    if (isPermissionError(error)) throw new NotFamilyAdminError()
    throw new Error('Die Einladungen konnten nicht geladen werden.')
  }
  return (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
    id: String(row.id ?? ''),
    createdAt: String(row.created_at ?? ''),
    expiresAt: String(row.expires_at ?? ''),
    redeemedAt: row.redeemed_at ? String(row.redeemed_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
  }))
}

export async function createHouseholdInvite(): Promise<CreatedHouseholdInvite> {
  const { data, error } = await requireSupabase().rpc('create_household_invite', {
    p_days: 7,
  })
  if (error) {
    if (isPermissionError(error)) throw new NotFamilyAdminError()
    throw new Error('Die Einladung konnte nicht erstellt werden.')
  }
  const row = Array.isArray(data) ? data[0] : null
  const token = typeof row?.token === 'string' ? row.token : ''
  const expiresAt = typeof row?.expires_at === 'string' ? row.expires_at : ''
  if (!token || !expiresAt) throw new Error('Die Einladung konnte nicht erstellt werden.')
  return { token, expiresAt }
}

export async function revokeHouseholdInvite(id: string): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc('revoke_household_invite', {
    p_id: id,
  })
  if (error) {
    if (isPermissionError(error)) throw new NotFamilyAdminError()
    throw new Error('Die Einladung konnte nicht widerrufen werden.')
  }
  return data === true
}

export async function redeemHouseholdInvite(token: string): Promise<RedeemResult> {
  const { data, error } = await requireSupabase().rpc('redeem_household_invite', {
    p_token: token.trim(),
  })
  if (error) {
    if (isInviteUnavailable(error)) throw new InviteUnavailableError()
    if (isPermissionError(error)) {
      throw new Error('Bitte melde dich an, um die Einladung anzunehmen.')
    }
    throw new Error('Der Beitritt konnte nicht abgeschlossen werden. Bitte später erneut versuchen.')
  }
  const status =
    typeof data === 'object' && data !== null
      ? (data as { status?: unknown }).status
      : null
  if (status === 'joined' || status === 'already_member') return status
  throw new Error('Der Beitritt konnte nicht abgeschlossen werden. Bitte später erneut versuchen.')
}
