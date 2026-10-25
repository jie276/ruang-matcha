import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"Mori Matcha · 来自贵州铜仁的绿意",description:"选用贵州铜仁茶叶，让抹茶成为你的日常。",icons:{icon:"/favicon.svg"}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
