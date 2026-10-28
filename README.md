# Outline Studio · Draw Music

Tool chuyển ảnh outline thành nét vẽ, đổi màu từng nét hoặc từng vùng, rồi xuất JSON dự án theo định dạng Draw Music 1.8. Canvas kết quả được dựng lại từ chính JSON xuất ra.

## Mở tool

Mở `dist/index.html` bằng trình duyệt hiện đại. Tool chạy offline, không cần cài thư viện hay backend. Giữ nguyên các tệp trong thư mục `dist`.

Nếu muốn xử lý tách nét bằng Web Worker để giao diện phản hồi tốt hơn với ảnh lớn, có thể chạy máy chủ tĩnh trên máy:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Sau đó mở `http://127.0.0.1:8000`. Lệnh cần Python có sẵn trên máy. Khi mở trực tiếp bằng `file:`, tool vẫn hoạt động; bước tách nét chạy trên luồng giao diện nên có thể khựng trong lúc xử lý.

## Cách dùng

1. Bấm **Thêm ảnh outline** hoặc kéo ảnh vào ô nguồn. Hỗ trợ PNG, JPG, WEBP và SVG được trình duyệt đọc như ảnh. Nét tối trên nền sáng hoặc nền trong suốt cho kết quả tốt nhất.
2. Đặt **Rộng/Cao** theo tỉ lệ canvas đích. Có thể bấm **Dùng tỉ lệ ảnh nguồn**, rồi chỉnh **Lề ảnh** nếu cần.
3. Chỉnh **Ngưỡng nét tối**, **Bỏ đốm nhỏ**, **Giản lược đường** và **Nét ngắn nhất**. Bật **Nét sáng trên nền tối** với ảnh đảo màu. Bấm **Chuyển ảnh thành nét** để áp dụng các thiết lập này.
4. Dùng **Chọn nét** và bấm vào một nét; giữ **Shift** khi bấm để chọn thêm hoặc bỏ bớt nét. Hoặc dùng **Khoanh vùng**, kéo một vòng quanh phần muốn đổi màu. Khoanh vùng sẽ chia nét tại ranh giới khi áp dụng, để phần ngoài vùng giữ màu cũ.
5. Chọn một trong 13 màu rồi bấm **Áp dụng màu đã chọn**. Màu áp dụng lên đường outline; tool không tô đặc khoảng bên trong hình. Có thể hoàn tác bằng **Ctrl+Z**, làm lại bằng **Ctrl+Shift+Z**, chọn tất cả hoặc xóa phần đã chọn.
6. Đặt tên, BPM, nốt gốc và thang âm. Bấm **Xuất JSON** để lưu dự án, **Ảnh PNG** để lưu hình kết quả hoặc **Xem JSON** để kiểm tra dữ liệu.
7. Dùng **Nhập JSON** để mở lại dự án đã lưu. **Thử với mẫu Fish** mở dữ liệu mẫu gốc từ APK để tham khảo.

Tool hiển thị số nét, số điểm, số nốt sau khi gộp ô và thời lượng một vòng. Bản này chuẩn bị hình và dữ liệu nhạc; chưa có nút nghe thử âm thanh.

## Bộ mẫu đi kèm

- `samples/fish-outline.png`: ảnh outline đen, dựng từ mẫu Fish đã cung cấp.
- `samples/fish-generated.json`: kết quả thực sự đi qua quy trình ảnh → đường tâm → đổi màu theo vùng → JSON. Có 28 nét, 316 điểm và 60 nốt sau khi gộp ô.
- `samples/fish-canvas.png`: hình dựng từ JSON kết quả trên canvas 680 × 660, với bảng màu pastel mới.

Để thử, tải ảnh outline vào tool rồi chuyển thành nét; hoặc nhập JSON kết quả để xem lại. Kết quả tách nét có thể khác khi thay đổi kích thước canvas, lề hoặc tham số.

## Kiểm chứng bản bàn giao

- Kiểm tra dữ liệu: 78 mẫu, 1.791 nét, 56.631 điểm; tính ô Bresenham đúng toàn bộ mẫu và round-trip định dạng thành công.
- 9 kiểm thử bộ tách nét, 9 kiểm thử khoanh vùng, 3 kiểm thử tích hợp thuật toán và 8 luồng thao tác trong Happy DOM + native Canvas đều đạt.
- Kiểm thử gồm tải PNG → tách nét → khoanh vùng → đổi màu → xuất JSON → nhập lại, cùng hoàn tác/làm lại và ảnh đảo nền. Ảnh Canvas trước xuất và sau nhập lại có dữ liệu PNG giống hệt nhau trong cùng bộ dựng kiểm thử.
- Điều khiển trình duyệt bị tắt trong phiên này nên chưa xác nhận bố cục trong trình duyệt thực tế. Chưa kiểm thử trên Android. Các kết quả trên không phải cam kết pixel-identical giữa trình duyệt và Android.

Xem `verification.json` để biết chi tiết kiểm thử. Bản bàn giao có thể chạy offline; việc xuất bản online chưa hoàn tất vì Sites báo không tìm thấy dự án đã đăng ký.

## Bảng màu tùy chỉnh

Đây là 13 mã màu pastel do bạn chọn, khác bảng màu gốc của APK 1.8 đã phân tích. `program` và `isFree` là metadata nhạc cụ; `isFree` không khóa thao tác trong tool.

| Nhạc cụ / tên JSON | Màu | program | isFree |
| --- | --- | ---: | :---: |
| Soft Key / `SOFT_KEY` | `#FFB6D2` | 4 | true |
| Marimba / `MARIMBA` | `#FFF0A8` | 12 | true |
| Warm Synth / `WARM_SYNTH` | `#FFCBA4` | 88 | true |
| Bells / `BELLS` | `#B8E8D0` | 14 | true |
| Pluck / `PLUCK` | `#C5D9B8` | 24 | true |
| Flute / `FLUTE` | `#AEBBFF` | 73 | true |
| Strings / `STRINGS` | `#FF9FAE` | 48 | false |
| Chime / `CHIME` | `#BFDFFF` | 10 | false |
| Bass / `BASS` | `#C8B6FF` | 38 | false |
| 8 bit / `EIGHT_BIT` | `#FFF4D6` | 80 | false |
| Electronic Bass / `ELECTRONIC_BASS` | `#A8E6E3` | 39 | false |
| Guitar / `GUITAR` | `#E6C8FF` | 25 | false |
| Saxophone / `SAXOPHONE` | `#83D4F7` | 65 | false |

JSON lưu tên nhạc cụ, không lưu mã hex riêng cho từng nét. Vì vậy app đích phải dùng cùng bảng màu này mới hiển thị đúng màu của tool. Ảnh PNG đã chứa màu kết quả.

## Giữ hình khi chuyển môi trường

- JSON dùng `version: 1`, lưới nhạc `24 × 32`, danh sách `strokes`, tọa độ `points` chuẩn hóa trong `[0,1]` và danh sách `cells` cho phần nhạc. Lưới không làm hình vẽ thành các ô vuông; hình hiển thị vẫn theo đường điểm liên tục.
- JSON không lưu tỉ lệ hoặc kích thước canvas. Dùng cùng tỉ lệ rộng/cao với canvas app để tránh kéo giãn hình. Nhập lại JSON cũng cần đặt lại tỉ lệ phù hợp nếu đang dùng canvas khác.
- Preview mô phỏng nét rộng 6 pixel, alpha `200/255`, đầu và góc nối tròn như mã vẽ của bản 1.8. Khử răng cưa, độ phân giải và cách dựng nét giữa trình duyệt với Android có thể khác; không cam kết trùng từng pixel.
- Bản APK 1.8 đã kiểm tra không có nút nhập JSON ngoài. File xuất đúng cấu trúc dự án, còn cách đưa vào app là một bước tích hợp riêng. Bản này bàn giao tool và tệp; chưa kiểm thử nhập/chạy trên Android thực tế.

## Giới hạn và lưu dữ liệu

- Tách nét dùng ngưỡng sáng, bỏ thành phần nhiễu nhỏ, tìm đường tâm và giản lược đường. Với ảnh mờ, nét quá dày, giao nhau phức tạp hoặc mảng tô đặc, đường tâm có thể lệch, phân nhánh hoặc mất chi tiết. Hãy thử lại tham số và kiểm tra hình trước khi lưu.
- Ảnh đầu vào tối đa 20 MB và 50 megapixel. Ảnh xử lý được giảm về cạnh dài tối đa 1.000 pixel; canvas xem trước có thể lớn hơn.
- Bộ tách nét mặc định giới hạn 5.000 đường và 150.000 điểm; ảnh phức tạp có thể chạm giới hạn và được cảnh báo. Định dạng dự án giới hạn 10.000 nét.
- Ảnh được xử lý tại trình duyệt, không tải lên máy chủ. Tool không tự lưu phiên làm việc; đóng hoặc tải lại trang có thể mất thay đổi. Hãy tải JSON để lưu công việc và nhập lại khi cần tiếp tục.
- Đối chiếu định dạng và thuật toán dựa trên mã đã giải mã cùng dữ liệu mẫu APK. Các kiểm tra trên tool không thay thế kiểm thử trực tiếp trong ứng dụng Android.
