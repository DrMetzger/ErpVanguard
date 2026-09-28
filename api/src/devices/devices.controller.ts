import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsISO8601, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requireAdmin } from '../common/access'
import { forgetDevice } from './device.guard'
import { one } from '../common/db'
import type { User } from '../users/user.entity'

class LocationDto {
  @IsNumber() @Min(-90) @Max(90) lat: number
  @IsNumber() @Min(-180) @Max(180) lng: number
  @IsOptional() @IsNumber() @Min(0) accuracy?: number
  @IsISO8601() at: string
}
class BlockDto {
  @IsOptional() @IsString() @Length(0, 200) reason?: string
}
class HeartbeatDto {
  @IsString() @Length(8, 64) deviceId: string
  @IsOptional() @IsString() @Length(0, 20) platform?: string
  @IsOptional() @IsString() @Length(0, 80) model?: string
  @IsOptional() @IsString() @Length(0, 40) osVersion?: string
  @IsOptional() @IsString() @Length(0, 40) appVersion?: string
  @IsOptional() @IsNumber() @Min(0) @Max(1) battery?: number
  @IsOptional() @IsBoolean() online?: boolean
  // Pontos guardados enquanto estava sem internet vão juntos (máx. 500 por envio).
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LocationDto) locations?: LocationDto[]
}

// Aparelhos com o app: o celular avisa que está ativo e onde está; o administrador vê no mapa.
@Controller('devices')
export class DevicesController {
  constructor(private readonly db: DataSource) {}

  @Post('heartbeat')
  async heartbeat(@CurrentUser() me: User, @Body() dto: HeartbeatDto) {
    const points = (dto.locations ?? []).filter((p) => Date.parse(p.at) <= Date.now() + 5 * 60_000).sort((a, b) => a.at.localeCompare(b.at))
    const last = points.at(-1)
    await this.db.transaction(async (tx) => {
      const current = await one(tx, `SELECT user_id FROM devices WHERE id = $1`, [dto.deviceId])
      if (current && current.user_id !== me.id) {
        // Aparelho trocou de usuário (outro login no mesmo celular).
        await tx.query(`UPDATE devices SET user_id = $2 WHERE id = $1`, [dto.deviceId, me.id])
      }
      await tx.query(
        `INSERT INTO devices (id, user_id, platform, model, os_version, app_version, battery, online, last_seen)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (id) DO UPDATE SET user_id = $2, platform = coalesce($3, devices.platform), model = coalesce($4, devices.model),
           os_version = coalesce($5, devices.os_version), app_version = coalesce($6, devices.app_version),
           battery = coalesce($7, devices.battery), online = coalesce($8, devices.online), last_seen = now()`,
        [dto.deviceId, me.id, dto.platform ?? null, dto.model ?? null, dto.osVersion ?? null, dto.appVersion ?? null, dto.battery ?? null, dto.online ?? null],
      )
      for (const p of points) {
        await tx.query(`INSERT INTO device_locations (device_id, user_id, lat, lng, accuracy, at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (device_id, at) DO NOTHING`,
          [dto.deviceId, me.id, p.lat, p.lng, p.accuracy ?? null, p.at])
      }
      if (last) {
        await tx.query(`UPDATE devices SET last_lat = $2, last_lng = $3, last_accuracy = $4, last_location_at = $5 WHERE id = $1 AND (last_location_at IS NULL OR last_location_at <= $5)`,
          [dto.deviceId, last.lat, last.lng, last.accuracy ?? null, last.at])
      }
    })
    return { ok: true, saved: points.length }
  }

  @Get()
  list(@CurrentUser() me: User) {
    requireAdmin(me)
    return this.db.query(
      `SELECT d.id, d.user_id AS "userId", u.name AS "userName", u.email AS "userEmail", d.platform, d.model, d.os_version AS "osVersion", d.app_version AS "appVersion",
              d.last_seen AS "lastSeen", d.last_lat AS lat, d.last_lng AS lng, d.last_accuracy AS accuracy, d.last_location_at AS "locationAt", d.battery, d.online,
              d.blocked, d.blocked_reason AS "blockedReason", d.blocked_at AS "blockedAt", (SELECT name FROM users WHERE id = d.blocked_by) AS "blockedBy"
       FROM devices d JOIN users u ON u.id = d.user_id ORDER BY d.last_seen DESC`,
    )
  }

  // Bloqueia o aparelho: o app sai do sistema e não entra mais até desbloquear.
  @Post(':id/block')
  async block(@CurrentUser() me: User, @Param('id') id: string, @Body() dto: BlockDto) {
    requireAdmin(me)
    const [, count] = await this.db.query(`UPDATE devices SET blocked = true, blocked_reason = $2, blocked_at = now(), blocked_by = $3 WHERE id = $1`, [id, dto.reason?.trim() || null, me.id])
    if (!count) throw new NotFoundException('Aparelho não encontrado')
    forgetDevice(id)
    return { ok: true, blocked: true }
  }

  @Post(':id/unblock')
  async unblock(@CurrentUser() me: User, @Param('id') id: string) {
    requireAdmin(me)
    const [, count] = await this.db.query(`UPDATE devices SET blocked = false, blocked_reason = NULL, blocked_at = NULL, blocked_by = NULL WHERE id = $1`, [id])
    if (!count) throw new NotFoundException('Aparelho não encontrado')
    forgetDevice(id)
    return { ok: true, blocked: false }
  }

  // Trajeto do aparelho num dia (horário de Brasília).
  @Get(':id/locations')
  async locations(@CurrentUser() me: User, @Param('id') id: string, @Query('date') date?: string) {
    requireAdmin(me)
    if (!(await one(this.db, `SELECT 1 FROM devices WHERE id = $1`, [id]))) throw new NotFoundException('Aparelho não encontrado')
    const day = date ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BadRequestException('Data inválida')
    return this.db.query(
      `SELECT lat, lng, accuracy, at FROM device_locations
       WHERE device_id = $1 AND at >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
       ORDER BY at LIMIT 5000`,
      [id, day],
    )
  }
}
