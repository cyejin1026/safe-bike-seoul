import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Safe Bike Seoul | 안전한 자전거 길찾기",
  description: "서울의 자전거 경로와 따릉이 대여소, 주행 정보를 확인해 보세요.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
