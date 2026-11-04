#pragma once
#include <array>
#include <cstdint>
#include <iomanip>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
namespace cinegather {
// Numeric-only wire record. -1 means unsupported/unreached, never a zero-duration claim.
struct NetworkTrace {
 static constexpr std::array<const char*,18> keys={"sequence","method","curlCode","httpStatus","osError","tlsBackendCode","tlsVerifyResult","tlsNativeCode","addressFamily","redirectCount","connectCount","dnsUs","tcpUs","tlsUs","requestReadyUs","firstByteUs","totalUs","wallUs"};
 std::array<int64_t,18> values;
 NetworkTrace(){values.fill(-1);}
 int64_t get(std::string_view key)const{for(size_t i=0;i<keys.size();++i)if(key==keys[i])return values[i];return -1;}
 bool set(std::string_view key,int64_t value){for(size_t i=0;i<keys.size();++i)if(key==keys[i]){values[i]=value;return true;}return false;}
 std::string json()const{std::ostringstream out;out<<'{';for(size_t i=0;i<keys.size();++i){if(i)out<<',';out<<'"'<<keys[i]<<"\":"<<values[i];}out<<'}';return out.str();}
 static std::optional<NetworkTrace> parse(std::string_view raw){
  if(raw.size()>2048)return {};std::istringstream in{std::string(raw)};char ch;NetworkTrace result;std::array<bool,18> seen{};
  if(!(in>>ch)||ch!='{')return {};
  for(size_t n=0;n<keys.size();++n){
   std::string key;int64_t value;if(!(in>>std::quoted(key)>>ch)||ch!=':'||!(in>>value))return {};
   size_t idx=0;while(idx<keys.size()&&key!=keys[idx])++idx;if(idx==keys.size()||seen[idx]||value < -1)return {};seen[idx]=true;result.values[idx]=value;
   if(!(in>>ch)||ch!=(n+1==keys.size()?'}':','))return {};
  }
  in>>std::ws;if(!in.eof())return {};
  if(result.get("sequence")<1||(result.get("method")!=1&&result.get("method")!=2)||result.get("curlCode")<0||result.get("curlCode")>999||result.get("httpStatus")>599||result.get("tlsBackendCode")>6)return {};
  auto family=result.get("addressFamily");if(family!=-1&&family!=0&&family!=4&&family!=6)return {};
  for(auto v:result.values)if(v>86400000000LL)return {};
  return result;
 }
};
class NetworkTelemetry {
 mutable std::mutex mutex;std::optional<NetworkTrace> post,del;
public:
 bool consume(std::string_view line){auto at=line.find("CG_WHIP_HTTP ");if(at==std::string_view::npos)return false;auto trace=NetworkTrace::parse(line.substr(at+13));if(!trace)return false;std::lock_guard<std::mutex> lock(mutex);if(trace->get("method")==1)post=*trace;else del=*trace;return true;}
 std::optional<NetworkTrace> connection()const{std::lock_guard<std::mutex> lock(mutex);return post;}
 std::optional<NetworkTrace> cleanup()const{std::lock_guard<std::mutex> lock(mutex);return del;}
 void reset(){std::lock_guard<std::mutex> lock(mutex);post.reset();del.reset();}
};
}
