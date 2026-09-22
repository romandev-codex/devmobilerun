import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

const deviceSchema = new Schema(
  {
    serial: { type: String, required: true, unique: true },
    displayName: { type: String, default: null },
    model: { type: String, default: null },
    /** Whether adb currently lists the device in the "device" state. */
    online: { type: Boolean, required: true, default: false },
    /** Raw adb state at last sync: device | offline | unauthorized | ... */
    adbState: { type: String, default: null },
    lastSeenAt: { type: Date, default: null },
    /** Device lock: the run currently executing on this device, if any. */
    activeRunId: { type: Schema.Types.ObjectId, ref: "Run", default: null },
    /** Battery temperature (°C) read before the last run attempt; null when unknown. */
    lastTemperatureC: { type: Number, default: null },
    /** Set when a run was skipped because the device was too hot; no run starts before it. */
    cooldownUntil: { type: Date, default: null },
  },
  { timestamps: true }
)

export type DeviceDoc = InferSchemaType<typeof deviceSchema> & {
  _id: mongoose.Types.ObjectId
}

export const Device: Model<DeviceDoc> =
  (mongoose.models.Device as Model<DeviceDoc>) ??
  mongoose.model<DeviceDoc>("Device", deviceSchema)
