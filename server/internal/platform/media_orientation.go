package platform

import (
	"bytes"
	"encoding/binary"
	"image"
)

// Only the bounded JPEG APP1 / TIFF IFD0 Orientation SHORT is inspected. No
// thumbnail, recursive IFD, external offset payload or other metadata is used.
// CIPA Exif 2.3, Orientation 0x0112 and table 6:
// https://www.cipa.jp/std/documents/e/DC-008-2012_E.pdf
func mediaJPEGOrientation(raw []byte) uint16 {
	if len(raw) < 4 || raw[0] != 0xff || raw[1] != 0xd8 {
		return 1
	}
	for offset := 2; offset < len(raw); {
		if raw[offset] != 0xff {
			return 1
		}
		for offset < len(raw) && raw[offset] == 0xff {
			offset++
		}
		if offset >= len(raw) {
			return 1
		}
		marker := raw[offset]
		offset++
		if marker == 0xda || marker == 0xd9 { // Never inspect entropy-coded pixels.
			return 1
		}
		if marker == 0x01 || (marker >= 0xd0 && marker <= 0xd8) {
			continue
		}
		if offset+2 > len(raw) {
			return 1
		}
		length := int(binary.BigEndian.Uint16(raw[offset : offset+2]))
		if length < 2 || length > len(raw)-offset {
			return 1
		}
		payload := raw[offset+2 : offset+length]
		offset += length
		if marker != 0xe1 || !bytes.HasPrefix(payload, []byte("Exif\x00\x00")) {
			continue
		}
		return mediaTIFFOrientation(payload[6:])
	}
	return 1
}

func mediaTIFFOrientation(tiff []byte) uint16 {
	if len(tiff) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	if order.Uint16(tiff[2:4]) != 42 {
		return 1
	}
	offset := uint64(order.Uint32(tiff[4:8]))
	if offset < 8 || offset+2 > uint64(len(tiff)) {
		return 1
	}
	count := uint64(order.Uint16(tiff[offset : offset+2]))
	start := offset + 2
	if count > (uint64(len(tiff))-start)/12 {
		return 1
	}
	for i := uint64(0); i < count; i++ {
		entry := tiff[start+i*12 : start+(i+1)*12]
		if order.Uint16(entry[:2]) != 0x0112 {
			continue
		}
		if order.Uint16(entry[2:4]) != 3 || order.Uint32(entry[4:8]) != 1 {
			return 1
		}
		value := order.Uint16(entry[8:10])
		if value >= 1 && value <= 8 {
			return value
		}
		return 1
	}
	return 1
}

// The caller validates the decoded pixel count before this allocation. Applying
// the orientation before re-encoding preserves the displayed photo while the
// encoder discards EXIF (including location and original orientation).
func orientMediaImage(src image.Image, rawJPEG []byte) image.Image {
	orientation := mediaJPEGOrientation(rawJPEG)
	if orientation == 1 {
		return src
	}
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	dw, dh := w, h
	if orientation >= 5 {
		dw, dh = h, w
	}
	dst := image.NewNRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < dh; y++ {
		for x := 0; x < dw; x++ {
			sx, sy := x, y
			switch orientation {
			case 2:
				sx = w - 1 - x
			case 3:
				sx, sy = w-1-x, h-1-y
			case 4:
				sy = h - 1 - y
			case 5:
				sx, sy = y, x
			case 6:
				sx, sy = y, h-1-x
			case 7:
				sx, sy = w-1-y, h-1-x
			case 8:
				sx, sy = w-1-y, x
			}
			dst.Set(x, y, src.At(bounds.Min.X+sx, bounds.Min.Y+sy))
		}
	}
	return dst
}
