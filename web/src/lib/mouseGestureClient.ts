/**
 * Thin client wrapper around the mouse-gesture custom RPC subsystem.
 *
 * Provides a typed promise-based API on top of the raw protobuf
 * encode/decode + ZMKCustomSubsystem.callRPC plumbing.
 */

import {
  ZMKConnection,
  ZMKCustomSubsystem,
} from "@cormoran/zmk-studio-react-hook";

// NOTE: These imports will resolve after running `npm run proto:gen`,
// which generates src/proto/zmk/mouse_gesture/custom.ts from the
// firmware-side custom.proto via ts-proto.
import {
  Request,
  Response,
  Gesture,
  Settings,
} from "../proto/zmk/mouse_gesture/custom";

export const SUBSYSTEM_IDENTIFIER = "cormoran__mouse_gesture";

export class MouseGestureClient {
  private readonly service: ZMKCustomSubsystem;

  constructor(connection: ZMKConnection, subsystemIndex: number) {
    this.service = new ZMKCustomSubsystem(connection, subsystemIndex);
  }

  private async call(req: Request): Promise<Response> {
    const payload = Request.encode(req).finish();
    const responsePayload = await this.service.callRPC(payload);
    if (!responsePayload) {
      throw new Error("Empty response from firmware");
    }
    const resp = Response.decode(responsePayload);
    if (resp.error) {
      throw new Error(resp.error.message || "Firmware returned error");
    }
    return resp;
  }

  async listGestures(): Promise<Gesture[]> {
    const resp = await this.call(Request.create({ listGestures: {} }));
    return resp.listGestures?.gestures ?? [];
  }

  async getGesture(id: number): Promise<Gesture | undefined> {
    const resp = await this.call(Request.create({ getGesture: { id } }));
    return resp.gesture?.gesture;
  }

  async addGesture(gesture: Gesture): Promise<Gesture | undefined> {
    const resp = await this.call(Request.create({ addGesture: { gesture } }));
    return resp.gesture?.gesture;
  }

  async updateGesture(gesture: Gesture): Promise<Gesture | undefined> {
    const resp = await this.call(Request.create({ updateGesture: { gesture } }));
    return resp.gesture?.gesture;
  }

  async deleteGesture(id: number): Promise<void> {
    await this.call(Request.create({ deleteGesture: { id } }));
  }

  async resetToDefaults(): Promise<void> {
    await this.call(Request.create({ resetToDefaults: {} }));
  }

  async getSettings(): Promise<Settings | undefined> {
    const resp = await this.call(Request.create({ getSettings: {} }));
    return resp.settings?.settings;
  }

  async setSettings(settings: Settings): Promise<void> {
    await this.call(Request.create({ setSettings: { settings } }));
  }
}
