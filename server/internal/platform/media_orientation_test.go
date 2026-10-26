package platform

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"reflect"
	"testing"
)

func mediaExifFixture(orientation uint16, order binary.ByteOrder) []byte {
	tiff := make([]byte, 26)
	copy(tiff, "II")
	if order == binary.BigEndian {
		copy(tiff, "MM")
	}
	order.PutUint16(tiff[2:4], 42)
	order.PutUint32(tiff[4:8], 8)
	order.PutUint16(tiff[8:10], 1)
	order.PutUint16(tiff[10:12], 0x0112)
	order.PutUint16(tiff[12:14], 3)
	order.PutUint32(tiff[14:18], 1)
	order.PutUint16(tiff[18:20], orientation)
	payload := append([]byte("Exif\x00\x00"), tiff...)
	header := []byte{0xff, 0xd8, 0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(header[4:6], uint16(len(payload)+2))
	return append(append(header, payload...), 0xff, 0xd9)
}

func TestMediaJPEGOrientationTransforms(t *testing.T) {
	// Asymmetric, non-zero bounds detect incorrect rotation direction and offsets.
	src := image.NewNRGBA(image.Rect(4, 7, 7, 9))
	for y := 0; y < 2; y++ {
		for x := 0; x < 3; x++ {
			src.SetNRGBA(x+4, y+7, color.NRGBA{R: uint8(y*3 + x + 1), A: 255})
		}
	}
	expected := [][][]uint8{
		{{1, 2, 3}, {4, 5, 6}},
		{{3, 2, 1}, {6, 5, 4}},
		{{6, 5, 4}, {3, 2, 1}},
		{{4, 5, 6}, {1, 2, 3}},
		{{1, 4}, {2, 5}, {3, 6}},
		{{4, 1}, {5, 2}, {6, 3}},
		{{6, 3}, {5, 2}, {4, 1}},
		{{3, 6}, {2, 5}, {1, 4}},
	}
	for orientation := uint16(1); orientation <= 8; orientation++ {
		for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
			raw := mediaExifFixture(orientation, order)
			if got := mediaJPEGOrientation(raw); got != orientation {
				t.Fatalf("orientation parse = %d, want %d", got, orientation)
			}
			result := orientMediaImage(src, raw)
			bounds := result.Bounds()
			var actual [][]uint8
			for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
				var row []uint8
				for x := bounds.Min.X; x < bounds.Max.X; x++ {
					row = append(row, color.NRGBAModel.Convert(result.At(x, y)).(color.NRGBA).R)
				}
				actual = append(actual, row)
			}
			if !reflect.DeepEqual(actual, expected[orientation-1]) {
				t.Fatalf("orientation %d: %v, want %v", orientation, actual, expected[orientation-1])
			}
		}
	}
}

func TestMediaOrientationIgnoresInvalidMetadata(t *testing.T) {
	valid := mediaExifFixture(6, binary.LittleEndian)
	invalid := [][]byte{nil, []byte("not a JPEG"), {0xff, 0xd8, 0xff}, {0xff, 0xd8, 0xff, 0xe1, 0, 1}, mediaExifFixture(0, binary.LittleEndian), mediaExifFixture(9, binary.BigEndian)}
	for _, at := range []int{12, 14, 16, 20, 22, 24} {
		broken := bytes.Clone(valid)
		broken[at] = 0xff
		invalid = append(invalid, broken)
	}
	for i := 0; i < len(valid)-2; i++ {
		invalid = append(invalid, valid[:i])
	}
	for i, raw := range invalid {
		if got := mediaJPEGOrientation(raw); got != 1 {
			t.Fatalf("malformed case %d parsed orientation %d", i, got)
		}
	}
	// An apparent APP1 after SOS is entropy data, not another metadata record.
	raw := append([]byte{0xff, 0xd8, 0xff, 0xda}, valid[2:]...)
	if mediaJPEGOrientation(raw) != 1 {
		t.Fatal("parsed orientation from entropy-coded data")
	}
}

func TestMediaOrientationReencodeDropsMetadata(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	var original bytes.Buffer
	if err := jpeg.Encode(&original, src, nil); err != nil {
		t.Fatal(err)
	}
	exif := mediaExifFixture(6, binary.BigEndian)
	raw := append(append(bytes.Clone(original.Bytes()[:2]), exif[2:len(exif)-2]...), original.Bytes()[2:]...)
	decoded, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err = jpeg.Encode(&output, orientMediaImage(decoded, raw), nil); err != nil {
		t.Fatal(err)
	}
	config, err := jpeg.DecodeConfig(bytes.NewReader(output.Bytes()))
	if err != nil || config.Width != 2 || config.Height != 3 || bytes.Contains(output.Bytes(), []byte("Exif")) {
		t.Fatal("orientation or metadata was not normalized")
	}
}
